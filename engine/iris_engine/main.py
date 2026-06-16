"""HTTP protocol surface. Runs as a localhost sidecar.

Dev mode:   python -m iris_engine.main   (port 8765, or ENGINE_PORT env)
Tauri mode: spawned by the shell at startup.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import sys

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import (compiler, document, geoms, guards, hierarchy, importer,
               reduce as reduce_mod, specnorm, stats, statmodel)

app = FastAPI(title="iris-engine")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "tauri://localhost", "http://tauri.localhost"],
    allow_methods=["*"], allow_headers=["*"],
)


def engine_snapshot() -> dict:
    import matplotlib, pingouin, scipy, seaborn
    return {"python": sys.version.split()[0], "scipy": scipy.__version__,
            "pingouin": pingouin.__version__, "matplotlib": matplotlib.__version__,
            "seaborn": seaborn.__version__, "pandas": pd.__version__}


class AnalyzeRequest(BaseModel):
    # a request carries the table inline OR references one cached via /table.
    # Wide datasets (tens of MB) upload once and then ride as a small token, so
    # rapid spec/pipeline edits don't re-send the whole table each time.
    table: dict | None = None
    table_token: str | None = None
    spec: dict


class ExportRequest(AnalyzeRequest):
    format: str = "pdf"
    dpi: int = 300


class SaveRequest(BaseModel):
    table: dict
    analyses: list[dict]
    provenance: dict


class LoadRequest(BaseModel):
    data_base64: str


class ReduceRequest(BaseModel):
    table: dict | None = None
    table_token: str | None = None
    steps: list[dict] = []
    # data hierarchy: when a non-raw level is requested, the preview shows that
    # level's grain (e.g. one row per cell) instead of the raw reduced rows.
    hierarchy: dict | None = None
    level: str | None = None


class TablePutRequest(BaseModel):
    table: dict


class HierarchyRequest(BaseModel):
    table: dict | None = None
    table_token: str | None = None
    spine: list[str] = []
    classifiers: list[str] = []


PREVIEW_CAP = 500  # rows returned by /reduce; UI shows "showing N of total"

# In-memory cache of recently-seen tables, keyed by a content hash. Bounds the
# repeated transfer of large master tables. LRU-ish: keep the last few.
_TABLE_CACHE: dict[str, dict] = {}
_TABLE_CACHE_ORDER: list[str] = []
_TABLE_CACHE_MAX = 4


def _cache_table(table: dict) -> str:
    raw = json.dumps(table, separators=(",", ":")).encode()
    token = hashlib.sha1(raw).hexdigest()
    if token not in _TABLE_CACHE:
        _TABLE_CACHE[token] = table
        _TABLE_CACHE_ORDER.append(token)
        while len(_TABLE_CACHE_ORDER) > _TABLE_CACHE_MAX:
            _TABLE_CACHE.pop(_TABLE_CACHE_ORDER.pop(0), None)
    return token


def _resolve_table(table: dict | None, token: str | None) -> dict:
    """A request may inline the table or reference a cached one by token.
    Inlining also refreshes the cache so a follow-up token request hits."""
    if table is not None:
        if token:
            _TABLE_CACHE.setdefault(token, table)
        return table
    if token and token in _TABLE_CACHE:
        return _TABLE_CACHE[token]
    raise HTTPException(409, "table not cached; resend full table")


class ImportPreviewRequest(BaseModel):
    filename: str
    data_base64: str
    options: dict = {}


class ImportCommitRequest(ImportPreviewRequest):
    columns: list[dict]


def _load_frame(table: dict, respect_exclusions: bool) -> tuple[pd.DataFrame, dict]:
    schema = table["schema"]
    df = pd.DataFrame(table["rows"])
    n_before = len(df)
    if respect_exclusions and "excluded" in df:
        df = df[~df["excluded"].fillna(False)]
    df = df.copy()
    df.attrs["n_excluded"] = n_before - len(df)
    for col in schema["columns"]:
        if col["type"] == "numeric" and col["name"] in df:
            df[col["name"]] = pd.to_numeric(df[col["name"]], errors="coerce")
    return df, schema


def _prepare(table: dict, spec: dict) -> tuple[pd.DataFrame, dict]:
    return _load_frame(table, spec.get("data", {}).get("respect_exclusions", True))


def _to_table(df: pd.DataFrame, schema: dict) -> dict:
    return {"schema": schema, "rows": json.loads(df.to_json(orient="records"))}


def _column_summary(df: pd.DataFrame, schema: dict) -> list[dict]:
    out = []
    for c in schema["columns"]:
        name = c["name"]
        if name not in df:
            continue
        s = df[name]
        out.append({"column": name, "n": int(s.notna().sum()),
                    "n_distinct": int(s.nunique(dropna=True)),
                    "n_missing": int(s.isna().sum())})
    return out


def _run(table: dict, spec: dict):
    spec = specnorm.normalize(spec)
    df, schema = _prepare(table, spec)
    steps = (spec.get("reduce") or {}).get("steps") or []
    try:
        df, schema = reduce_mod.apply_reduction(df, schema, steps)
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e

    describe_only = bool(spec.get("_describe_only"))
    model = statmodel.infer(spec["encodings"], schema, spec.get("_override"),
                            spec.get("facet"))
    # Data hierarchy (redesign): per-level tables for the group-comparison path,
    # filled in below once the grouping column is known. None elsewhere.
    level_tables = None
    if describe_only and model["family"] != "none":
        # the user asked to render the figure but run no inferential test
        model["chosen_by"] = "describe_only"
        model["test"] = None
    # Phase 4: statmodel.infer already forces chosen_by == "describe_only" when
    # faceted; fold that back into the local flag so the stats dispatch below
    # (which branches on `describe_only`, not on the model) skips the real test.
    describe_only = describe_only or model["chosen_by"] == "describe_only"
    spec["stat_model"] = model

    issues = guards.evaluate(df, schema, spec, model)
    blocking = next((i for i in issues if i["level"] == "blocking"), None)
    if blocking:
        raise HTTPException(422, blocking["message"])

    enc = spec["encodings"]
    alpha = spec.get("stats", {}).get("alpha", 0.05)
    override = spec.get("_override")
    family = model["family"]
    if family == "group_comparison":
        enc_x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
        enc_y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
        # Phase 3c: detect horizontal orientation (numeric x + categorical y).
        # The stats function always receives (grouping_col, value_col); for
        # horizontal the roles are swapped relative to the encoding axes.
        x_is_numeric = any(c["name"] == enc_x and c["type"] == "numeric"
                           for c in schema["columns"]) if enc_x else False
        if x_is_numeric:
            cat_col, val_col = enc_y, enc_x   # horizontal: y groups, x measures
        else:
            cat_col, val_col = enc_x, enc_y   # vertical: x groups, y measures
        cat_schema = next((c for c in schema["columns"] if c["name"] == cat_col), None)
        if cat_schema is None:
            raise HTTPException(
                422, f"grouping column {cat_col!r} not found in schema")
        # Materialize one table per hierarchy level. The grain always retains the
        # columns this figure splits by (x grouping, colour, facets) so a coarse
        # level can still be compared/coloured rather than averaging them away.
        hier = spec.get("hierarchy") or {}
        spine = hierarchy.spine_present(df, hier.get("spine") or [])
        color = enc.get("color")
        color_col = color["column"] if color and color.get("column") else None
        facet = spec.get("facet") or {}
        frow = facet.get("row") or {}
        fcol = facet.get("col") or {}
        # dedupe (order-preserving): a column may drive several encodings at once
        # — e.g. a superplot groups by class on x *and* colours by the same class.
        split_cols = list(dict.fromkeys(
            c for c in (cat_col, color_col, frow.get("column"), fcol.get("column"))
            if c and c in df.columns))
        level_tables, present_spine = hierarchy.materialize_levels(
            df, schema, spine, hier.get("fn"), split_cols)
        # Pairing follows from the spine (paired/partially/unpaired across the
        # qualifier's coarser-than-home units); surfaced for the deferred stats.
        model["spine"] = present_spine
        model["pairing"] = hierarchy.pairing(df, present_spine, cat_col)
        res = (stats.describe_groups(
                   df, cat_col, val_col,
                   levels=cat_schema.get("levels", []), alpha=alpha)
               if describe_only else
               stats.group_comparison(
                   df, cat_col, val_col,
                   levels=cat_schema.get("levels", []), alpha=alpha,
                   override=override, pairing=model["pairing"]))
    elif family == "correlation":
        res = (stats.describe_pairs(df, enc["x"]["column"], enc["y"]["column"],
                                    alpha=alpha)
               if describe_only else
               stats.correlation(df, enc["x"]["column"], enc["y"]["column"],
                                 alpha=alpha, override=override))
    elif family == "descriptive":
        res = stats.descriptive(df, enc["y"]["column"], alpha=alpha)
    elif family == "contingency":
        # Phase 3d: tile/heatmap — count rows per (x_level, y_level) cell.
        enc_x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
        enc_y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
        x_sch = next((c for c in schema["columns"] if c["name"] == enc_x), None)
        y_sch = next((c for c in schema["columns"] if c["name"] == enc_y), None)
        x_levels = ((x_sch.get("levels") or []) if x_sch else []) or sorted(
            str(v) for v in df[enc_x].dropna().unique())
        y_levels = ((y_sch.get("levels") or []) if y_sch else []) or sorted(
            str(v) for v in df[enc_y].dropna().unique())
        res = (stats.contingency_counts(df, enc_x, enc_y, x_levels, y_levels,
                                        alpha=alpha)
               if describe_only else
               stats.contingency_test(df, enc_x, enc_y, x_levels, y_levels,
                                      alpha=alpha, override=override))
    else:
        raise HTTPException(422, "no statistical model — map X / Y to analyze")
    if "error" in res:
        raise HTTPException(422, res["error"])
    fig, point_groups = compiler.build_figure(df, schema, spec, res, level_tables)
    return fig, point_groups, res, df, schema, model, issues


@app.get("/health")
def health():
    return {"status": "ok", "engine_snapshot": engine_snapshot(),
            "registry": geoms.registry_payload()}


@app.get("/sample")
def sample():
    return document.load_sample()


@app.post("/table")
def table_put(req: TablePutRequest):
    """Cache a table and return a content token for subsequent token-only
    analyze/reduce/export calls."""
    return {"token": _cache_table(req.table)}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    table = _resolve_table(req.table, req.table_token)
    fig, point_groups, res, df, schema, model, issues = _run(table, req.spec)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return {"figure": {"svg": svg, "point_groups": point_groups},
            "stats": res, "stat_model": model, "issues": issues,
            "engine_snapshot": engine_snapshot()}


@app.post("/reduce")
def reduce_preview(req: ReduceRequest):
    """Preview-only: apply the reduction steps and return the (capped) reduced
    table plus a per-step trace, with no figure/stats render. Drives the live
    pipeline editor before any X/Y mapping exists."""
    table = _resolve_table(req.table, req.table_token)
    df, schema = _load_frame(table, respect_exclusions=True)
    try:
        out, sch, trace = reduce_mod.reduce_with_trace(df, schema, req.steps)
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e
    # collapse to the requested hierarchy level (RAW = the reduced rows as-is)
    spine = hierarchy.spine_present(out, (req.hierarchy or {}).get("spine") or [])
    if req.level and req.level != hierarchy.RAW and spine:
        levels, _ = hierarchy.materialize_levels(
            out, sch, spine, (req.hierarchy or {}).get("fn"), [])
        out, sch = hierarchy.resolve_level(levels, req.level)
    out = out.drop(columns=["row_ids"], errors="ignore")
    return {"preview": _to_table(out.head(PREVIEW_CAP), sch),
            "n_total": int(len(out)),
            "trace": trace,
            "summary": _column_summary(out, sch)}


@app.post("/hierarchy")
def hierarchy_describe(req: HierarchyRequest):
    """Describe the data hierarchy for the Data-tab editor: per-level grain
    cardinalities and where each classifier attaches (its home level). Reuses the
    same home-level logic that drives pairing, so the visualization and the
    inference basis can't disagree."""
    table = _resolve_table(req.table, req.table_token)
    df, schema = _load_frame(table, respect_exclusions=True)
    return hierarchy.describe_hierarchy(df, req.spine, req.classifiers)


@app.post("/export")
def export(req: ExportRequest):
    if req.format not in ("svg", "pdf", "png"):
        raise HTTPException(400, "format must be svg, pdf, or png")
    table = _resolve_table(req.table, req.table_token)
    fig, _, _, _, _, _, _ = _run(table, req.spec)
    data = compiler.figure_to_bytes(fig, req.format, dpi=req.dpi)
    compiler.close(fig)
    return {"filename": f"figure.{req.format}",
            "data_base64": base64.b64encode(data).decode()}


@app.post("/import/preview")
def import_preview(req: ImportPreviewRequest):
    try:
        return importer.preview(base64.b64decode(req.data_base64),
                                req.filename, req.options)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read file: {e}") from e


@app.post("/import/commit")
def import_commit(req: ImportCommitRequest):
    try:
        return importer.commit(base64.b64decode(req.data_base64),
                               req.filename, req.options, req.columns)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not import file: {e}") from e


@app.post("/document/save")
def doc_save(req: SaveRequest):
    data = document.save_document(req.table["schema"], req.table["rows"],
                                  req.analyses, req.provenance,
                                  engine_snapshot())
    return {"filename": "document.viz",
            "data_base64": base64.b64encode(data).decode()}


@app.post("/document/load")
def doc_load(req: LoadRequest):
    try:
        return document.load_document(base64.b64decode(req.data_base64))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read document: {e}") from e


def _exit_when_stdin_closes():
    """Parent-death watchdog. The shell spawns us with a piped stdin and
    IRIS_WATCH_STDIN=1; if the shell dies for any reason — including
    SIGKILL, which never runs its exit handlers — the OS closes the pipe
    and we exit instead of lingering as an orphan on the port."""
    try:
        while sys.stdin.buffer.read(4096):
            pass
    except Exception:  # noqa: BLE001
        pass
    os._exit(0)


def main():
    import threading

    import uvicorn
    if os.environ.get("IRIS_WATCH_STDIN") == "1":
        threading.Thread(target=_exit_when_stdin_closes, daemon=True).start()
    port = int(os.environ.get("ENGINE_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
