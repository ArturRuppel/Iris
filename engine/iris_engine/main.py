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
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import (compiler, document, geoms, guards, hierarchy, importer,
               reduce as reduce_mod, session as session_mod, specnorm, stats,
               statmodel)

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
    table: dict | None = None
    table_id: str | None = None
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


class CreateSessionRequest(BaseModel):
    table: dict


class WindowRequest(BaseModel):
    start: int = 0
    end: int = 100


class EditRequest(BaseModel):
    row_id: str
    column: str
    value: object | None = None


class ExcludeRequest(BaseModel):
    row_id: str


class DistinctRequest(BaseModel):
    column: str


PREVIEW_CAP = 500  # rows returned by /reduce; UI shows "showing N of total"

# In-memory cache of recently-seen tables, keyed by a content hash. Bounds the
# repeated transfer of large master tables. LRU-ish: keep the last few.
_TABLE_CACHE: dict[str, dict] = {}
_TABLE_CACHE_ORDER: list[str] = []
_TABLE_CACHE_MAX = 4

_SESSIONS = session_mod.SessionStore()


def _store_table(token: str, table: dict) -> str:
    if token not in _TABLE_CACHE:
        _TABLE_CACHE[token] = table
        _TABLE_CACHE_ORDER.append(token)
        while len(_TABLE_CACHE_ORDER) > _TABLE_CACHE_MAX:
            _TABLE_CACHE.pop(_TABLE_CACHE_ORDER.pop(0), None)
    return token


def _cache_table(table: dict) -> str:
    # content hash so an identical re-upload hits the same cache entry
    raw = json.dumps(table, separators=(",", ":")).encode()
    return _store_table(hashlib.sha1(raw).hexdigest(), table)


def _resolve_table(table: dict | None, token: str | None) -> dict:
    """A request may inline the table, reference the session table by its id, or
    reference a content-cached one by token. Inlining also refreshes the cache so
    a follow-up token request hits."""
    if table is not None:
        if token:
            _TABLE_CACHE.setdefault(token, table)
        return table
    sess = _SESSIONS.get(token)
    if sess is not None:
        # the full row list for compute; pandas already holds it, so this is an
        # in-process slice, not a transfer.
        return {"schema": sess.schema, "rows": sess.window(0, sess.n)}
    if token and token in _TABLE_CACHE:
        return _TABLE_CACHE[token]
    raise HTTPException(409, "table not cached; resend full table")


def _session_or_409(tid: str) -> "session_mod.SessionTable":
    t = _SESSIONS.get(tid)
    if t is None:
        raise HTTPException(409, "session table not found; reload the data")
    return t


class ImportUploadRequest(BaseModel):
    filename: str
    data_base64: str


class ImportPreviewRequest(BaseModel):
    # the file rides inline (data_base64) for small entries, or as a token once
    # the wizard has uploaded it via /import/upload — so re-previews on every
    # option toggle don't re-ship tens of MB of base64.
    filename: str
    data_base64: str | None = None
    file_token: str | None = None
    options: dict = {}


class ImportCommitRequest(ImportPreviewRequest):
    columns: list[dict]


# Uploaded import files (raw bytes) and their parsed frames, both keyed by a
# content hash. The frame cache means changing a column's *type* in the wizard
# re-renders the preview without re-parsing the file (types don't affect the
# parse), and commit reuses the frame the last preview already built.
_IMPORT_BYTES: dict[str, bytes] = {}
_IMPORT_BYTES_ORDER: list[str] = []
_IMPORT_FRAMES: dict[str, tuple] = {}
_IMPORT_FRAMES_ORDER: list[str] = []
_IMPORT_CACHE_MAX = 4


def _lru_put(store: dict, order: list, key, value, cap: int) -> None:
    if key not in store:
        store[key] = value
        order.append(key)
        while len(order) > cap:
            store.pop(order.pop(0), None)


def _import_bytes_token(data: bytes) -> str:
    token = hashlib.sha1(data).hexdigest()
    _lru_put(_IMPORT_BYTES, _IMPORT_BYTES_ORDER, token, data, _IMPORT_CACHE_MAX)
    return token


def _resolve_import_bytes(token: str | None, b64: str | None) -> tuple[bytes, str]:
    if b64 is not None:
        data = base64.b64decode(b64)
        return data, _import_bytes_token(data)
    if token and token in _IMPORT_BYTES:
        return _IMPORT_BYTES[token], token
    raise HTTPException(409, "file not uploaded; resend file")


def _import_frame(token: str, filename: str, options: dict,
                  sample: bool = False) -> tuple:
    """Parse (and cache) the frame for these bytes + read options. Per-column
    `types` are excluded from the key — they don't affect the parse. `sample`
    parses only a head sample for the headers-first pass and is cached
    separately (a sample and a full parse of the same inputs must not collide)."""
    read_opts = {k: options.get(k) for k in
                 ("delimiter", "decimal", "header", "sheet", "reshape")}
    key = (token + filename + json.dumps(read_opts, sort_keys=True, default=str)
           + ("sample" if sample else "full"))
    key = hashlib.sha1(key.encode()).hexdigest()
    hit = _IMPORT_FRAMES.get(key)
    if hit is None:
        reader = importer.read_header_frame if sample else importer.read_frame
        hit = reader(_IMPORT_BYTES[token], filename, options)
        _lru_put(_IMPORT_FRAMES, _IMPORT_FRAMES_ORDER, key, hit, _IMPORT_CACHE_MAX)
    return hit


def frame_from_table(table: dict) -> pd.DataFrame:
    """Build a DataFrame from either table wire format: columnar
    (`{columns: {name: [...]}}`, the compact form sent by /import/commit) or the
    legacy row form (`{rows: [{...}]}`, still used by edits/saves/sample)."""
    if "columns" in table:
        return pd.DataFrame(table["columns"])
    return pd.DataFrame(table.get("rows", []))


def _load_frame(table: dict, respect_exclusions: bool) -> tuple[pd.DataFrame, dict]:
    schema = table["schema"]
    df = frame_from_table(table)
    n_before = len(df)
    if respect_exclusions and "excluded" in df:
        df = df[~df["excluded"].fillna(False)]
    df = df.copy()
    df.attrs["n_excluded"] = n_before - len(df)
    # A `bool` column (a stochastic-event flag) collapses to numeric 1/0 for every
    # compute path — so a summary/bar of it reads as the fraction of trues — and
    # is presented as numeric to the rest of the engine. Normalize a copy of the
    # schema so the compiler/stats/guards never need a bool branch (and the cached
    # source table's schema isn't mutated).
    norm_cols = []
    for col in schema["columns"]:
        if col["type"] in ("numeric", "bool") and col["name"] in df:
            df[col["name"]] = pd.to_numeric(df[col["name"]], errors="coerce")
        if col["type"] == "bool":
            col = {**col, "type": "numeric"}
        norm_cols.append(col)
    return df, {**schema, "columns": norm_cols}


def _prepare(table: dict, spec: dict) -> tuple[pd.DataFrame, dict]:
    return _load_frame(table, spec.get("data", {}).get("respect_exclusions", True))


def _to_table(df: pd.DataFrame, schema: dict) -> dict:
    return {"schema": schema, "rows": json.loads(df.to_json(orient="records"))}


def fast_json(payload: dict) -> JSONResponse:
    """Serialize a payload that's already JSON-native (plain str/num/bool/None,
    as our table rows are) and return it as a Response. Returning a Response
    directly makes FastAPI skip `jsonable_encoder`, whose deep re-walk of a
    multi-million-cell table costs more than the json.dumps itself."""
    return JSONResponse(payload)


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
                            spec.get("facet"), layers=spec.get("layers"))
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
        # One source of truth: the test reads the SAME materialized grain the
        # figure draws — never a parallel raw-vs-level route. The inferential grain
        # is the coarsest level any layer is bound to (the prominent "unit" marks;
        # a summary at `date` reports spread across dates — the honest n). With no
        # spine, or layers left at the raw level, this resolves to the raw reduced
        # rows, so the spineless path is unchanged.
        layer_levels = [layer.get("level", hierarchy.RAW)
                        for layer in spec.get("layers", [])]
        inf_level = hierarchy.coarsest_level(present_spine, layer_levels)
        model["inferential_level"] = inf_level
        stat_df, _ = hierarchy.resolve_level(level_tables, inf_level)
        res = (stats.describe_groups(
                   stat_df, cat_col, val_col,
                   levels=cat_schema.get("levels", []), alpha=alpha)
               if describe_only else
               stats.group_comparison(
                   stat_df, cat_col, val_col,
                   levels=cat_schema.get("levels", []), alpha=alpha,
                   override=override, pairing=model["pairing"]))
    elif family == "correlation":
        res = (stats.describe_pairs(df, enc["x"]["column"], enc["y"]["column"],
                                    alpha=alpha)
               if describe_only else
               stats.correlation(df, enc["x"]["column"], enc["y"]["column"],
                                 alpha=alpha, override=override))
    elif family == "timeseries":
        # Describe-only in the first cut (no inferential test on time courses).
        # The figure (build_timeseries_figure) computes its own per-timepoint
        # means/bands and per-unit curves internally from the raw rows, so the
        # stats result is a legible describe-only summary, not a test.
        res = stats.timeseries(df, enc["x"]["column"], enc["y"]["column"],
                               alpha=alpha)
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
    data = document.load_sample()                       # {schema, rows}
    tid = _SESSIONS.create(data["schema"],
                           frame_from_table(data))
    t = _SESSIONS.get(tid)
    return {"id": tid, "n": t.n, "version": t.version,
            "schema": data["schema"], "rows": t.window(0, 200),
            "counts": t.counts()}


@app.post("/table")
def table_put(req: TablePutRequest):
    """Cache a table and return a content token for subsequent token-only
    analyze/reduce/export calls."""
    return {"token": _cache_table(req.table)}


@app.post("/table/create")
def table_create(req: CreateSessionRequest):
    """Build the server-owned session table from a {schema, rows|columns} payload
    and return its stable id + row count + version. The browser keeps the id, not
    the rows."""
    schema = req.table["schema"]
    df = frame_from_table(req.table)
    if "id" not in df:
        df.insert(0, "id", [str(i + 1) for i in range(len(df))])
    if "excluded" not in df:
        df["excluded"] = False
    tid = _SESSIONS.create(schema, df)
    t = _SESSIONS.get(tid)
    return {"id": tid, "n": t.n, "version": t.version, "schema": schema,
            "counts": t.counts()}


@app.post("/table/{tid}/rows")
def table_rows(tid: str, req: WindowRequest):
    t = _session_or_409(tid)
    return fast_json({"rows": t.window(req.start, req.end),
                      "n": t.n, "version": t.version})


@app.post("/table/{tid}/edit")
def table_edit(tid: str, req: EditRequest):
    t = _session_or_409(tid)
    try:
        t.edit_cell(req.row_id, req.column, req.value)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"version": t.version, "counts": t.counts()}


@app.post("/table/{tid}/exclude")
def table_exclude(tid: str, req: ExcludeRequest):
    t = _session_or_409(tid)
    try:
        excluded = t.toggle_exclusion(req.row_id)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"excluded": excluded, "version": t.version, "counts": t.counts()}


@app.post("/table/{tid}/distinct")
def table_distinct(tid: str, req: DistinctRequest):
    t = _session_or_409(tid)
    try:
        return {"values": t.distinct(req.column)}
    except KeyError as e:
        raise HTTPException(422, str(e)) from e


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


@app.post("/import/upload")
def import_upload(req: ImportUploadRequest):
    """Cache an import file's bytes once; preview/commit then reference it by
    token so wizard edits don't re-transfer the whole file."""
    return {"token": _import_bytes_token(base64.b64decode(req.data_base64))}


@app.post("/import/headers")
def import_headers(req: ImportPreviewRequest):
    """Fast first pass: parse only a head sample so the wizard can show the
    columns (and a provisional type guess) immediately; the client then calls
    /import/preview for the full-data stats + preview rows."""
    try:
        _, token = _resolve_import_bytes(req.file_token, req.data_base64)
        df, resolved = _import_frame(token, req.filename, req.options, sample=True)
        return importer.preview_headers_from_frame(df, resolved, req.options)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read file: {e}") from e


@app.post("/import/preview")
def import_preview(req: ImportPreviewRequest):
    try:
        _, token = _resolve_import_bytes(req.file_token, req.data_base64)
        df, resolved = _import_frame(token, req.filename, req.options)
        return importer.preview_from_frame(df, resolved, req.options)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read file: {e}") from e


@app.post("/import/commit")
def import_commit(req: ImportCommitRequest):
    try:
        _, token = _resolve_import_bytes(req.file_token, req.data_base64)
        df, resolved = _import_frame(token, req.filename, req.options)
        table = importer.commit_from_frame(df, resolved, req.columns, columnar=True)
        # Cache the committed table and hand back its token so the client can
        # skip the immediate re-upload (/table) it would otherwise do to obtain
        # one — a second ~hundreds-of-MB transfer of the table we just sent. The
        # token is derived from the inputs (file + read options + column types),
        # which fully determine the table, so it's cheap (no re-serialization).
        key = (token + json.dumps(req.options, sort_keys=True, default=str)
               + json.dumps(req.columns, sort_keys=True))
        ttok = _store_table(hashlib.sha1(key.encode()).hexdigest(), table)
        return fast_json({**table, "token": ttok})
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not import file: {e}") from e


@app.post("/document/save")
def doc_save(req: SaveRequest):
    table = _resolve_table(req.table, req.table_id)
    data = document.save_document(table["schema"], table["rows"],
                                  req.analyses, req.provenance,
                                  engine_snapshot())
    return {"filename": "document.iris",
            "data_base64": base64.b64encode(data).decode()}


@app.post("/document/load")
def doc_load(req: LoadRequest):
    try:
        doc = document.load_document(base64.b64decode(req.data_base64))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read document: {e}") from e
    tid = _SESSIONS.create(doc["schema"], frame_from_table(doc))
    t = _SESSIONS.get(tid)
    return {**doc, "id": tid, "n": t.n, "version": t.version,
            "rows": t.window(0, 200), "counts": t.counts()}     # first window only


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
