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
    would produce, including the bookkeeping ``id``/``excluded`` columns."""
    df = pd.read_csv(case.__case_dir__ / case.DATA)
    schema = _build_schema(df, getattr(case, "SCHEMA_OVERRIDES", {}) or {})
    rows = json.loads(df.to_json(orient="records"))
    for i, r in enumerate(rows, 1):
        r["id"] = str(i)
        r["excluded"] = False
    return {"schema": schema, "rows": rows}


def _analyses(case: ModuleType) -> list[dict]:
    """The spec dicts to persist, one per ANALYSES entry, each given a stable id
    (``<case>-NN``) so the saved document parts are named and ordered."""
    out = []
    for i, an in enumerate(case.ANALYSES, 1):
        spec = dict(an["spec"])
        spec.setdefault("id", f"{case.__case_dir__.name}-{i:02d}")
        out.append(spec)
    return out


def build_iris(case: ModuleType, *, write: bool = True) -> bytes:
    """Build the case's ``.iris`` bytes (the real, openable document). Writes it
    to ``artifacts/<case>.iris`` unless ``write=False``."""
    table = build_table(case)
    provenance = {"source": "iris-engine validation corpus",
                  "case": case.__case_dir__.name,
                  "title": getattr(case, "TITLE", case.__case_dir__.name),
                  "data_source": getattr(case, "SOURCE", ""),
                  "exclusions": []}
    data = document.save_document(table["schema"], table["rows"],
                                  _analyses(case), provenance,
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
        else:
            raise KeyError(f"unknown expected_figure key {key!r}")


# --------------------------------------------------------------------- validate

def render_svg(case: ModuleType, spec: dict, *, write: bool = True) -> str:
    """Run one analysis through the engine and return its figure SVG, writing it
    to ``artifacts/`` for human spot-checking ('look for yourself')."""
    table = {"schema": case.__built__["schema"], "rows": case.__built__["rows"]}
    fig, _, res, _, _, model, issues = main._run(table, spec)
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
