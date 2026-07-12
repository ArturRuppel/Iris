"""Shared machinery for the validation corpus: build a case's ``.iris`` from its
human-readable sources, then validate the *built* document through the engine's
real entry point.

``build_iris`` and ``validate`` are the two public verbs. ``build.py`` calls the
first to ship a demo; ``test_validation.py`` calls the second in CI. Neither
reimplements the pipeline — building goes through ``document.save_document`` and
validating goes through ``main._run`` / ``compiler.figure_to_svg``, the exact
paths the app uses — so a case both exercises and ships the real thing.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pandas as pd

from iris_engine import compiler, document, main

from . import svgstruct

ROOT = Path(__file__).resolve().parent
CASES_DIR = ROOT / "cases"
ARTIFACTS = ROOT / "artifacts"

_MISSING = object()


# ----------------------------------------------------------------- case loading

def case_dirs() -> list[Path]:
    """Every case folder (one with a ``case.py``), sorted by name."""
    return sorted(p for p in CASES_DIR.iterdir()
                  if p.is_dir() and (p / "case.py").exists())


def load_case(case_dir: Path | str) -> ModuleType:
    case_dir = Path(case_dir)
    spec = importlib.util.spec_from_file_location(
        f"validation_case_{case_dir.name.replace('-', '_')}",
        case_dir / "case.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.__case_dir__ = case_dir
    return mod


# ------------------------------------------------------------------ table build

def _build_schema(df: pd.DataFrame, overrides: dict) -> dict:
    """The same inference ``load_sample`` uses, plus a per-case override hook so
    a case can pin an explicit type or level order the inference can't know."""
    schema = document._infer_schema(df)
    if not overrides:
        return schema
    cols = {c["name"]: c for c in schema["columns"]}
    for name, patch in overrides.items():
        if name not in cols:
            raise KeyError(f"SCHEMA_OVERRIDES names unknown column {name!r}")
        cols[name] = {**cols[name], **patch}
    return {**schema, "columns": [cols[c["name"]] for c in schema["columns"]]}


def build_table(case: ModuleType) -> dict:
    """Read ``data.csv`` → a wire table ({schema, rows}) exactly as an import
    would produce, including the bookkeeping ``id`` column."""
    df = pd.read_csv(case.__case_dir__ / case.DATA)
    schema = _build_schema(df, getattr(case, "SCHEMA_OVERRIDES", {}) or {})
    rows = json.loads(df.to_json(orient="records"))
    for i, r in enumerate(rows, 1):
        r["id"] = str(i)
    return {"schema": schema, "rows": rows}


def _linear_to_dag_spec(spec: dict, main_id: str, next_num: int) -> tuple[dict, dict, int]:
    """Convert a linear 2.1 spec to a 2.2 reduce DAG, mirroring the frontend's
    resolveSaveDag (state.ts): one `src` source, a straight ``inputs`` chain, a
    single ``output``. A join's inline ``right`` table is PROMOTED to a pool table
    (``table_N``) referenced by id from a synthesized right-source node, dissolving
    the legacy inline-right form into an ordinary fan-in node — so the file loads
    through the frontend's adoptReduceDag like any saved join. ``post`` stays a
    linear chain (``reduce.post``), unchanged. Returns (spec, extra_tables, next_num).
    Idempotent: a spec already at 2.2 passes through untouched."""
    spec = dict(spec)
    if spec.get("spec_version") == "2.2":
        return spec, {}, next_num
    reduce_block = spec.get("reduce") or {}
    steps = list(reduce_block.get("steps") or [])
    post = list(reduce_block.get("post") or [])
    nodes: list[dict] = [{"id": "src", "kind": "source", "table_id": main_id}]
    extra: dict[str, dict] = {}
    prev = "src"
    for i, raw in enumerate(steps):
        step = dict(raw)
        nid = f"n{i}"
        if step.get("kind") == "join":
            right_inline = step.get("right")
            if right_inline is not None:                      # promote to a pool table
                rid = f"table_{next_num}"; next_num += 1
                extra[rid] = {"schema": right_inline["schema"],
                              "hierarchy": {"spine": [], "fn": {}},
                              "rows": right_inline["rows"]}
                right_ref = rid
            else:
                right_ref = step.get("right_table_id") or ""
            rnode = f"{nid}__right"
            nodes.append({"id": rnode, "kind": "source", "table_id": right_ref})
            nodes.append({"id": nid, "kind": "step", "inputs": [prev, rnode],
                          "step": {"kind": "join", "on": step.get("on", []),
                                   "how": step.get("how", "inner")}})
        else:
            nodes.append({"id": nid, "kind": "step", "inputs": [prev], "step": step})
        prev = nid
    new_reduce: dict = {"nodes": nodes, "output": prev}
    if post:
        new_reduce["post"] = post
    spec["spec_version"] = "2.2"
    spec["table_id"] = main_id
    spec["reduce"] = new_reduce
    return spec, extra, next_num


def _inline_dag_sources(spec: dict, pool: dict) -> dict:
    """Inline each source node's rows from `pool` (id -> {schema, rows, ...}) so the
    engine's DAG evaluator can load them — the render-time mirror of the frontend's
    resolveEngineDag, which inlines source rows at the request boundary. A no-op for
    a linear (non-DAG) spec."""
    reduce_block = spec.get("reduce") or {}
    nodes = reduce_block.get("nodes")
    if not nodes:
        return spec
    out = []
    for n in nodes:
        if n.get("kind") == "source" and "table" not in n and n.get("table_id") in pool:
            t = pool[n["table_id"]]
            n = {**n, "table": {"schema": t["schema"], "rows": t["rows"]}}
        out.append(n)
    return {**spec, "reduce": {**reduce_block, "nodes": out}}


def _dag_analyses(case: ModuleType, main_id: str) -> tuple[list[dict], dict]:
    """The 2.2 spec dicts to persist, one per ANALYSES entry (each given a stable id
    ``<case>-NN``), plus any pool tables promoted from a join's inline right."""
    specs: list[dict] = []
    extra: dict[str, dict] = {}
    next_num = 2
    for i, an in enumerate(case.ANALYSES, 1):
        spec = dict(an["spec"])
        spec.setdefault("id", f"{case.__case_dir__.name}-{i:02d}")
        spec, more, next_num = _linear_to_dag_spec(spec, main_id, next_num)
        specs.append(spec)
        extra.update(more)
    return specs, extra


def build_iris(case: ModuleType, *, write: bool = True) -> bytes:
    """Build the case's ``.iris`` bytes (the real, openable document). Writes it
    to ``artifacts/<case>.iris`` unless ``write=False``."""
    table = build_table(case)
    provenance = {"source": "iris-engine validation corpus",
                  "case": case.__case_dir__.name,
                  "title": getattr(case, "TITLE", case.__case_dir__.name),
                  "data_source": getattr(case, "SOURCE", ""),
                  "exclusions": []}
    specs, extra_tables = _dag_analyses(case, "table_1")
    tables = {"table_1": {"schema": table["schema"],
                          "hierarchy": {"spine": [], "fn": {}},
                          "rows": table["rows"]},
              **extra_tables}
    data = document.save_document(tables, specs, provenance,
                                  main.engine_snapshot())
    if write:
        ARTIFACTS.mkdir(exist_ok=True)
        (ARTIFACTS / f"{case.__case_dir__.name}.iris").write_bytes(data)
    return data


def load_built(case: ModuleType, *, rebuild: bool = False) -> dict:
    """Load the built ``.iris`` (building it first if missing or ``rebuild``).
    Returns the loaded document dict — schema, rows, analyses, provenance."""
    path = ARTIFACTS / f"{case.__case_dir__.name}.iris"
    data = build_iris(case) if (rebuild or not path.exists()) else path.read_bytes()
    return document.load_document(data)


# --------------------------------------------------------------- stat assertions

def _resolve(res: dict, key: str):
    """Look a field up in a stats result. A dotted key walks the path from the
    result root (with integer segments indexing lists); a bare key is found at
    the top level or, failing that, inside ``result`` — so a case can write the
    natural ``"r"`` / ``"p"`` and reach ``res["result"]["r"]``."""
    if "." in key:
        segs = key.split(".")
        got = _walk(res, segs)
        return got if got is not _MISSING else _walk(res.get("result", {}), segs)
    if key in res:
        return res[key]
    return res.get("result", {}).get(key, _MISSING)


def _walk(cur, segs):
    for seg in segs:
        if isinstance(cur, list):
            try:
                cur = cur[int(seg)]
            except (ValueError, IndexError):
                return _MISSING
        elif isinstance(cur, dict) and seg in cur:
            cur = cur[seg]
        else:
            return _MISSING
    return cur


_OPS = {"<": lambda a, b: a < b, ">": lambda a, b: a > b,
        "<=": lambda a, b: a <= b, ">=": lambda a, b: a >= b}


def _check_field(name: str, expected, actual) -> None:
    if actual is _MISSING:
        raise AssertionError(
            f"stat {name!r} is absent from the result (silent drift?)")
    if isinstance(expected, tuple):
        op, bound = expected
        if op in _OPS:
            assert _OPS[op](actual, bound), \
                f"stat {name!r}: {actual!r} not {op} {bound!r}"
        elif op == "~":
            assert abs(actual - bound) <= abs(bound) * 1e-3 + 1e-12, \
                f"stat {name!r}: {actual!r} not ~ {bound!r}"
        else:  # (value, abs_tol)
            value, tol = expected
            assert abs(actual - value) <= tol, \
                f"stat {name!r}: |{actual!r} - {value!r}| > {tol!r}"
    else:
        assert actual == expected, f"stat {name!r}: {actual!r} != {expected!r}"


def assert_stats(res: dict, expected: dict) -> None:
    for name, want in expected.items():
        _check_field(name, want, _resolve(res, name))


def assert_model(model: dict, expected: dict) -> None:
    for key, want in expected.items():
        got = model.get(key, _MISSING)
        assert got == want, f"model {key!r}: {got!r} != {want!r}"


# -------------------------------------------------------------- figure assertions

def assert_figure(facts: svgstruct.SvgFacts, expected: dict) -> None:
    assert facts.has_svg, "no <svg> root in rendered figure"
    for key, want in expected.items():
        if key == "axis_labels":
            for axis, lbl in want.items():
                got = facts.axis_labels.get(axis)
                assert got == lbl, f"axis {axis} label: {got!r} != {lbl!r}"
        elif key == "n_points":
            assert facts.n_points == want, \
                f"n_points: {facts.n_points} != {want}"
        elif key == "point_groups":
            assert len(facts.point_groups) == want, \
                f"point_groups: {len(facts.point_groups)} != {want}"
        elif key == "xtick_labels":
            assert facts.xtick_labels == want, \
                f"xtick_labels: {facts.xtick_labels!r} != {want!r}"
        elif key == "title":
            assert facts.title == want, f"title: {facts.title!r} != {want!r}"
        elif key == "annotation_contains":
            assert facts.annotation and want in facts.annotation, \
                f"annotation {facts.annotation!r} lacks {want!r}"
        elif key == "min_patches":
            assert facts.n_patches >= want, \
                f"n_patches {facts.n_patches} < {want}"
        elif key == "legend_labels":
            assert facts.legend_labels == want, \
                f"legend_labels: {facts.legend_labels!r} != {want!r}"
        else:
            raise KeyError(f"unknown expected_figure key {key!r}")


# --------------------------------------------------------------------- validate

def render_svg(case: ModuleType, spec: dict, *, write: bool = True) -> str:
    """Run one analysis through the engine and return its figure SVG, writing it
    to ``artifacts/`` for human spot-checking ('look for yourself')."""
    _, t = next(iter(case.__built__["tables"].items()))
    table = {"schema": t["schema"], "rows": t["rows"]}
    spec = _inline_dag_sources(spec, case.__built__["tables"])
    fig, res, _, _, model, issues = main._run(table, spec)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    if write:
        ARTIFACTS.mkdir(exist_ok=True)
        gid = spec.get("id") or case.__case_dir__.name
        (ARTIFACTS / f"{gid}.svg").write_text(svg)
    return svg, res, model, issues


def validate(case_dir: Path | str, *, rebuild: bool = False) -> dict:
    """Build (if needed) and validate one case end-to-end: load the real
    ``.iris``, run every saved analysis through ``main._run``, and assert its
    stats, chosen model, and figure structure. Returns a per-analysis summary."""
    case = load_case(case_dir)
    doc = load_built(case, rebuild=rebuild)
    case.__built__ = doc
    assert len(doc["analyses"]) == len(case.ANALYSES), (
        f"{case.__case_dir__.name}: {len(doc['analyses'])} saved analyses "
        f"but {len(case.ANALYSES)} expectations")

    results = []
    for spec, expect in zip(doc["analyses"], case.ANALYSES):
        svg, res, model, _ = render_svg(case, spec)
        assert_stats(res, expect["expected_stats"])
        assert_model(model, expect["expected_model"])
        assert_figure(svgstruct.parse(svg), expect["expected_figure"])
        results.append({"id": spec.get("id"), "test": res["result"].get("test"),
                        "family": model.get("family")})
    return {"case": case.__case_dir__.name, "analyses": results}
