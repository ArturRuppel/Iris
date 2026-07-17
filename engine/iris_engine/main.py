"""HTTP protocol surface. Runs as a localhost sidecar.

Dev mode:   python -m iris_engine.main   (port 8765, or ENGINE_PORT env)
Tauri mode: spawned by the shell at startup.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import math
import os
import sys
import threading
from collections import OrderedDict

import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import (autosave, build_info, compiler, document, geoms, guards,
               hierarchy, importer, methods as methods_mod,
               reduce as reduce_mod, render as render_mod, session as session_mod,
               shape as shape_mod, specnorm, style as style_mod)
from .render import _load_frame, frame_from_table

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


class ExportMethodsRequest(BaseModel):
    # Whole-document methods/stats export. `tables` resolve each analysis's main
    # table (a SaveTable.name equals the analysis's spec.table_id); `analyses` are
    # the LIVE specs (joins inlined as `right`, so the run path resolves them).
    tables: list[SaveTable]
    analyses: list[dict]
    format: str = "md"


class SaveTable(BaseModel):
    name: str
    table_id: str | None = None      # session id to read full rows from
    table: dict | None = None        # inline fallback ({schema, rows})
    hierarchy: dict = {"spine": [], "fn": {}}


class SaveRequest(BaseModel):
    tables: list[SaveTable]
    analyses: list[dict]
    provenance: dict = {}


class LoadRequest(BaseModel):
    data_base64: str


class AutosaveRequest(BaseModel):
    tables: list[SaveTable]
    analyses: list[dict]
    provenance: dict = {}
    # the client's data identity: pool ids + session ids + versions. Equal
    # fingerprints mean the table data is unchanged, so only the spec sidecar
    # is rewritten (the .iris data tier is left alone).
    data_fingerprint: str = ""


class ReduceRequest(BaseModel):
    table: dict | None = None
    table_token: str | None = None
    steps: list[dict] = []
    # a reduce DAG {nodes, output} (spec 2.2); when present, supersedes
    # `table`/`table_token` + `steps` (which stay for the legacy linear callers
    # — the live preview and /shape_counts still send those in this phase).
    # Every source node must carry its own inline `table` — a DAG request is
    # self-contained, unlike the legacy `table`/`table_token` + `steps` split.
    reduce: dict | None = None
    # data hierarchy: when a non-raw level is requested, the preview shows that
    # level's grain (e.g. one row per cell) instead of the raw reduced rows.
    hierarchy: dict | None = None
    level: str | None = None
    # when set, return the table AFTER step index `at_step` (slicing steps[:at_step+1]);
    # -1 means the raw table before any step. Drives the explorer data tab. Takes
    # precedence over `level` (flatten-level inspection is a separate node kind).
    # Not yet supported alongside `reduce` (a DAG request always returns its
    # `output` node; per-node fetching is Phase C/D, via distinct node ids).
    at_step: int | None = None
    # un-forcing the nesting: fetch an arbitrary collapse grain by key (kept dims
    # joined by '/'). Takes precedence over `level` when both are set.
    collapse: list[dict] | None = None
    grain: str | None = None


class ShapeCountsRequest(BaseModel):
    table: dict | None = None
    table_token: str | None = None
    steps: list[dict] = []
    # a reduce DAG {nodes, output} (spec 2.2); accepted for forward-compat with
    # the client's spec shape, but NOT YET wired into the per-node counts below
    # — those are keyed by pipeline-step-index (`sc.steps[i]`/`sc.joins[i]`),
    # matching the still-unconverted explorer graph (Phase C moves both to
    # node ids together). Present here only so the request model accepts it.
    reduce: dict | None = None
    hierarchy: dict | None = None
    # un-forcing the nesting: the per-analysis plan (grain-list), chosen test
    # grain, and the comparison qualifier (for the pairing-flip guard). Absent
    # collapse -> default chain.
    collapse: list[dict] | None = None
    test_grain: str | None = None
    qualifier: str | None = None
    # post-collapse reduce phase (reduce.post): drives the post-aggregate-derive guard
    post: list[dict] | None = None


class TablePutRequest(BaseModel):
    table: dict


class HierarchyRequest(BaseModel):
    table: dict | None = None
    table_token: str | None = None
    spine: list[str] = []
    classifiers: list[str] = []


class CreateSessionRequest(BaseModel):
    # the table rides inline, or references one already cached via /import/commit
    # (or /table) by its content token — so a freshly imported table isn't shipped
    # to the browser and then straight back to the engine to seed the session.
    table: dict | None = None
    table_token: str | None = None


class WindowRequest(BaseModel):
    start: int = 0
    end: int = 100


class EditRequest(BaseModel):
    row_id: str
    column: str
    value: object | None = None


class EditCellsRequest(BaseModel):
    # a batch of {row_id, column, value} edits (grouped-sheet paste / range-clear),
    # applied atomically with a single version bump.
    edits: list[EditRequest]


class RelabelRequest(BaseModel):
    column: str
    from_label: str
    to_label: str


class DeleteRowsRequest(BaseModel):
    ids: list[str]


class AddLevelRequest(BaseModel):
    factor: str
    level: str


class DropColumnRequest(BaseModel):
    column: str


class DistinctRequest(BaseModel):
    column: str


class SchemaRequest(BaseModel):
    # the full replacement column schema (types/labels/levels). Named
    # `table_schema` because a field literally named `schema` shadows a BaseModel
    # attribute in pydantic v2.
    table_schema: dict


PREVIEW_CAP = 500  # rows returned by /reduce; UI shows "showing N of total"

# In-memory cache of recently-seen tables, keyed by a content hash. Bounds the
# repeated transfer of large master tables. LRU-ish: keep the last few.
# Guarded by a lock: uvicorn runs these sync endpoints in a threadpool, so the
# dict + order-list mutations (and the eviction loop) can otherwise interleave.
_TABLE_CACHE: dict[str, dict] = {}
_TABLE_CACHE_ORDER: list[str] = []
_TABLE_CACHE_MAX = 4
_TABLE_CACHE_LOCK = threading.Lock()

_SESSIONS = session_mod.SessionStore()

# Stats memoization. The statistical result depends only on the data and the
# spec's analysis fields — never on presentation — so a style-only edit (moving
# a legend, recolouring, fonts) can reuse the computed stats and re-render in
# figure-build time (~300 ms) instead of rerunning the whole pipeline, which is
# seconds for a many-group comparison. Keyed on a stable data identity plus the
# spec with presentation/derived blocks stripped; a small LRU of result dicts.
_STATS_CACHE: "OrderedDict[str, dict]" = OrderedDict()
_STATS_CACHE_MAX = 64
# Same threadpool hazard as _TABLE_CACHE: get+move_to_end and store+evict must
# be atomic or concurrent requests can interleave an eviction with a move_to_end
# on the evicted key (KeyError → 500). Compute stays outside the lock.
_STATS_CACHE_LOCK = threading.Lock()
# Blocks the stats dispatch in `_run` provably never reads: pure figure furniture
# (`style`) and engine-derived outputs (`stat_model`, `engine_snapshot`). Stripping
# is a denylist on purpose — everything else stays in the key, so a future
# analysis field can never be silently served stale. The conservative direction
# for a correctness-critical tool: an over-broad key only costs a recompute.
_STATS_IRRELEVANT = frozenset({"style", "stat_model", "engine_snapshot"})


def _table_identity(table: dict | None, token: str | None) -> str | None:
    """A cheap, stable id for the resolved data, used as the stats-cache data key.
    The live app references the session table by id, whose `version` bumps on
    every edit — equal ids therefore mean identical data. Returns None
    (caching disabled) for an inline-only table we won't pay to hash."""
    if token:
        sess = _SESSIONS.get(token)
        if sess is not None:
            return f"sess:{token}:{sess.version}"
        with _TABLE_CACHE_LOCK:
            if token in _TABLE_CACHE:
                return f"tok:{token}"      # token is itself a content hash
    return None


def _stats_cache_key(data_id: str | None, spec: dict) -> str | None:
    if not data_id:
        return None
    relevant = {k: v for k, v in spec.items() if k not in _STATS_IRRELEVANT}
    blob = json.dumps(relevant, sort_keys=True, separators=(",", ":"), default=str)
    return data_id + "\x00" + hashlib.sha1(blob.encode()).hexdigest()


def _memo_stats(key: str | None, compute):
    """Return the cached stats for `key`, else compute, store, and return. The
    uncacheable (key is None) and error results always recompute. Copies on the
    way in and out so neither the cache nor a caller can mutate the other's dict."""
    if key is None:
        return compute()
    with _STATS_CACHE_LOCK:
        hit = _STATS_CACHE.get(key)
        if hit is not None:
            _STATS_CACHE.move_to_end(key)
            hit = copy.deepcopy(hit)
    if hit is not None:
        return hit
    res = compute()
    if isinstance(res, dict) and "error" not in res:
        stored = copy.deepcopy(res)
        with _STATS_CACHE_LOCK:
            _STATS_CACHE[key] = stored
            _STATS_CACHE.move_to_end(key)
            while len(_STATS_CACHE) > _STATS_CACHE_MAX:
                _STATS_CACHE.popitem(last=False)
    return res


# Render-pipeline memoization. Everything from the reduced frame through the
# materialized hierarchy levels and the stats result is a pure function of the
# data identity and the analysis spec — never of presentation. Profiling the
# deep-spine superplots showed the cost is the hierarchy materialization (~1 s
# for 80k rows over a 4-level spine), not the stats call, so memoizing stats
# alone left a style-only edit (moving a legend, recolouring, fonts) re-running
# the whole pipeline. This cache keeps the entire style-independent result so
# such an edit only re-runs build_figure (~100 ms). Keyed identically to the
# stats cache (style stripped); bounded by an approximate byte budget because
# each entry holds the reduced frame plus its per-level tables. build_figure
# treats these frames as read-only (it slices/filters into new frames), so
# entries are shared by reference rather than copied.
_PIPELINE_CACHE: "OrderedDict[str, tuple[tuple, int]]" = OrderedDict()
_PIPELINE_CACHE_BUDGET = 300 * 1024 * 1024   # ~300 MB, matching the frontend LRU
_PIPELINE_CACHE_BYTES = 0
# Guards the OrderedDict AND the byte counter — the counter is read-modify-write
# in _pipeline_put, so unlocked concurrent puts drift the accounting.
_PIPELINE_CACHE_LOCK = threading.Lock()


def _frame_bytes(df) -> int:
    try:
        return int(df.memory_usage(deep=True).sum())
    except Exception:
        return 0


def _pipeline_get(key: str | None):
    if key is None:
        return None
    with _PIPELINE_CACHE_LOCK:
        hit = _PIPELINE_CACHE.get(key)
        if hit is None:
            return None
        _PIPELINE_CACHE.move_to_end(key)
        return hit[0]


def _pipeline_put(key: str | None, payload: tuple, level_tables: dict) -> None:
    if key is None:
        return
    global _PIPELINE_CACHE_BYTES
    nbytes = _frame_bytes(payload[0])           # the reduced frame
    for ldf, _schema in (level_tables or {}).values():
        nbytes += _frame_bytes(ldf)
    with _PIPELINE_CACHE_LOCK:
        old = _PIPELINE_CACHE.pop(key, None)
        if old is not None:
            _PIPELINE_CACHE_BYTES -= old[1]
        _PIPELINE_CACHE[key] = (payload, nbytes)
        _PIPELINE_CACHE_BYTES += nbytes
        # evict oldest until under budget, but never the entry we just stored
        while _PIPELINE_CACHE_BYTES > _PIPELINE_CACHE_BUDGET and len(_PIPELINE_CACHE) > 1:
            _, (_old_payload, old_bytes) = _PIPELINE_CACHE.popitem(last=False)
            _PIPELINE_CACHE_BYTES -= old_bytes


def _store_table(token: str, table: dict) -> str:
    with _TABLE_CACHE_LOCK:
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
            # route through _store_table so the entry is tracked by the eviction
            # order list; a bare setdefault here leaked (unbounded, invisible to
            # eviction) — idempotent, so a repeat token is a no-op.
            _store_table(token, table)
        return table
    sess = _SESSIONS.get(token)
    if sess is not None:
        # Hand compute the frame directly. Serializing it to a row list here only
        # to rebuild a DataFrame in `frame_from_table` was ~0.6 s of per-cell
        # boxing for an 80k-row table on every request; the `frame` key skips it.
        return {"schema": sess.schema, "frame": sess.snapshot()}
    with _TABLE_CACHE_LOCK:
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
# One lock for both import stores (bytes + frames): same threadpool hazard as
# _TABLE_CACHE — concurrent puts can interleave the append with the eviction pop.
_IMPORT_CACHE_LOCK = threading.Lock()


def _lru_put(store: dict, order: list, key, value, cap: int) -> None:
    with _IMPORT_CACHE_LOCK:
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
    if token:
        with _IMPORT_CACHE_LOCK:
            data = _IMPORT_BYTES.get(token)
        if data is not None:
            return data, token
    raise HTTPException(409, "file not uploaded; resend file")


def _import_frame(data: bytes, token: str, filename: str, options: dict,
                  sample: bool = False) -> tuple:
    """Parse (and cache) the frame for these bytes + read options. Per-column
    `types` are excluded from the key — they don't affect the parse. `sample`
    parses only a head sample for the headers-first pass and is cached
    separately (a sample and a full parse of the same inputs must not collide).
    Takes the resolved bytes rather than re-reading _IMPORT_BYTES[token], which
    could be evicted between the resolve and the parse (a misleading KeyError)."""
    read_opts = {k: options.get(k) for k in
                 ("delimiter", "decimal", "header", "sheet", "reshape")}
    key = (token + filename + json.dumps(read_opts, sort_keys=True, default=str)
           + ("sample" if sample else "full"))
    key = hashlib.sha1(key.encode()).hexdigest()
    with _IMPORT_CACHE_LOCK:
        hit = _IMPORT_FRAMES.get(key)
    if hit is None:
        reader = importer.read_header_frame if sample else importer.read_frame
        hit = reader(data, filename, options)
        _lru_put(_IMPORT_FRAMES, _IMPORT_FRAMES_ORDER, key, hit, _IMPORT_CACHE_MAX)
    return hit


def _to_table(df: pd.DataFrame, schema: dict) -> dict:
    # session_mod.records uses to_dict (exact) rather than to_json, whose
    # 10-decimal-place default silently truncates small floats to 0.
    return {"schema": schema, "rows": session_mod.records(df)}


def fast_json(payload: dict) -> JSONResponse:
    """Serialize a payload that's already JSON-native (plain str/num/bool/None,
    as our table rows are) and return it as a Response. Returning a Response
    directly makes FastAPI skip `jsonable_encoder`, whose deep re-walk of a
    multi-million-cell table costs more than the json.dumps itself."""
    return JSONResponse(payload)


def _json_safe(obj):
    """Recursively replace non-finite floats (NaN, +/-inf) with None so the
    payload survives strict JSON serialization. Degenerate inputs — a zero-
    variance group, a single-unit correlation — legitimately yield NaN effect
    sizes and CIs in stats.py, and FastAPI's json.dumps rejects those, 500-ing
    the whole /analyze call. None is the honest "undefined here" value, matching
    the isfinite guards already in stats.py. (np.float64 subclasses float, so
    numpy scalars are covered too.)"""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj


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


def _run(table, spec: dict, data_id: str | None = None):
    # HTTP adapter over render.render: adds the per-request caches and maps
    # RenderError -> 422. The substantive pipeline lives in iris_engine.render so
    # it stays importable without FastAPI (the bare `pip install iris-engine`).
    #
    # `table` is the resolved table dict, or a zero-arg callable returning one.
    # Resolving the session table serializes the whole frame to rows (~0.6 s for
    # an 80k-row table), so it's deferred behind the pipeline-cache check: a
    # style-only edit hits the cache and returns from build_figure without ever
    # paying for it.
    spec = specnorm.normalize(spec)
    # Built before any spec mutation below. The whole style-independent pipeline
    # (reduction, hierarchy materialization, stats) is memoized on this key, so a
    # style-only edit skips straight to build_figure; the terminal stats call is
    # additionally memoized on the same key for the pipeline-cache miss path.
    stats_key = _stats_cache_key(data_id, spec)
    cached = _pipeline_get(stats_key)
    if cached is not None:
        df, schema, model, res, issues, level_tables = cached
        spec["stat_model"] = model
        # guards.evaluate mutates the spec in place — drop_unrenderable_channels
        # nulls out any aesthetic channel the compiler can't draw (e.g. size on a
        # categorical column) — and on a cache MISS that happens inside render()
        # before build_figure. The pipeline cache stores the pipeline OUTPUT, not
        # the mutated spec, and its key is style-independent, so a style-only
        # re-render arrives here with the channel still mapped. Re-apply the same
        # deterministic drop (schema + encodings are both in the cache key, so it
        # yields exactly what the miss path produced) — otherwise the un-dropped
        # channel reaches the compiler and 500s, or silently draws a different
        # figure than the miss path did (§1.4).
        guards.drop_unrenderable_channels(schema, spec)
        fig = compiler.build_figure(df, schema, spec, res, level_tables)
        return fig, res, df, schema, model, issues
    table = table() if callable(table) else table
    try:
        fig, res, df, schema, model, issues, level_tables = render_mod.render(
            table, spec, memo=lambda compute: _memo_stats(stats_key, compute))
    except render_mod.RenderError as e:
        raise HTTPException(422, str(e)) from e
    _pipeline_put(stats_key, (df, schema, model, res, issues, level_tables),
                  level_tables or {})
    return fig, res, df, schema, model, issues


@app.get("/health")
def health():
    return {"status": "ok", "engine_snapshot": engine_snapshot(),
            "registry": geoms.registry_payload(),
            "style_registry": style_mod.style_registry_payload()}


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
    table = _resolve_table(req.table, req.table_token)
    schema = table["schema"]
    df = frame_from_table(table)
    if "id" not in df:
        df.insert(0, "id", [str(i + 1) for i in range(len(df))])
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


@app.post("/table/{tid}/edit_cells")
def table_edit_cells(tid: str, req: EditCellsRequest):
    """Apply a batch of cell edits atomically (grouped-sheet paste / range-clear):
    one version bump, one refetch. `applied` is how many landed, so the UI can
    state what a paste wrote (and, by difference, what it skipped)."""
    t = _session_or_409(tid)
    applied = t.edit_cells([e.model_dump() for e in req.edits])
    return {"version": t.version, "counts": t.counts(), "applied": applied}


@app.post("/table/{tid}/schema")
def table_schema(tid: str, req: SchemaRequest):
    """Retype the session's columns in place (Data-tab role change) so the engine's
    test inference sees the new types. Data-only invariant: no row changes.
    `identifier_warning` is a non-blocking note when the identifiers don't jointly
    key the table (a legitimate coarse-over-replicates spine), else null."""
    t = _session_or_409(tid)
    try:
        warning = t.set_schema(req.table_schema)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"version": t.version, "schema": t.schema, "counts": t.counts(),
            "identifier_warning": warning}


@app.post("/table/{tid}/relabel")
def table_relabel(tid: str, req: RelabelRequest):
    """Rename a categorical level across its rows (grouped-sheet header rename).
    Returns whether it merged into a sibling level, so the UI can state the loss;
    the schema rides back because its level list may have changed."""
    t = _session_or_409(tid)
    try:
        info = t.relabel_category(req.column, req.from_label, req.to_label)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"version": t.version, "schema": t.schema, "counts": t.counts(), **info}


@app.post("/table/{tid}/delete_rows")
def table_delete_rows(tid: str, req: DeleteRowsRequest):
    """Drop tidy rows by id (grouped-sheet column/band delete). Returns the number
    actually removed so the UI states the loss against the server's truth."""
    t = _session_or_409(tid)
    removed = t.delete_rows(req.ids)
    return {"version": t.version, "counts": t.counts(), "removed": removed}


@app.post("/table/{tid}/add_level")
def table_add_level(tid: str, req: AddLevelRequest):
    """Add a new level to a categorical factor, blank across the design
    (grouped-sheet add-column). Not lossy; returns how many rows it appended and
    the new schema (its level list may have grown)."""
    t = _session_or_409(tid)
    try:
        info = t.add_level(req.factor, req.level)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"version": t.version, "schema": t.schema, "counts": t.counts(), **info}


@app.post("/table/{tid}/drop_column")
def table_drop_column(tid: str, req: DropColumnRequest):
    """Drop a categorical factor column (grouped-sheet grouping-row delete).
    Lossy — the factor's labels are gone — so the UI confirms first. Returns the
    new schema (the factor list changed) for the client to sync."""
    t = _session_or_409(tid)
    try:
        info = t.drop_column(req.column)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"version": t.version, "schema": t.schema, "counts": t.counts(), **info}


@app.post("/table/{tid}/distinct")
def table_distinct(tid: str, req: DistinctRequest):
    t = _session_or_409(tid)
    try:
        return {"values": t.distinct(req.column)}
    except KeyError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    data_id = _table_identity(req.table, req.table_token)
    fig, res, df, schema, model, issues = _run(
        lambda: _resolve_table(req.table, req.table_token), req.spec, data_id)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return {"figure": {"svg": svg},
            "stats": _json_safe(res), "stat_model": model, "issues": issues,
            "engine_snapshot": engine_snapshot()}


@app.post("/reduce")
def reduce_preview(req: ReduceRequest):
    """Preview-only: apply the reduction steps and return the (capped) reduced
    table plus a per-step trace, with no figure/stats render. Drives the live
    pipeline editor before any X/Y mapping exists."""
    if req.at_step is not None and req.at_step < -1:
        raise HTTPException(422, "at_step must be >= -1")
    if req.reduce is not None:
        from . import dag as dag_mod
        try:
            cache, order = dag_mod.evaluate_dag_traced(req.reduce)
        except dag_mod.DagError as e:
            raise HTTPException(422, f"reduction failed: {e}") from e
        out, sch = cache[req.reduce["output"]]
        by_id = {n["id"]: n for n in req.reduce["nodes"]}
        trace = [{"n_rows_out": int(len(cache[nid][0])), "schema_out": cache[nid][1]}
                 for nid in order if by_id[nid].get("kind") == "step"]
        out = out.drop(columns=["row_ids"], errors="ignore")
        return {"preview": _to_table(out.head(PREVIEW_CAP), sch),
                "n_total": int(len(out)),
                "trace": trace,
                "summary": _column_summary(out, sch)}
    table = _resolve_table(req.table, req.table_token)
    df, schema = _load_frame(table)
    steps = req.steps if req.at_step is None else req.steps[: req.at_step + 1]
    try:
        out, sch, trace = reduce_mod.reduce_with_trace(df, schema, steps)
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e
    # collapse to the requested hierarchy level (RAW = the reduced rows as-is).
    # Skipped when inspecting an intermediate step: flatten is a separate node.
    spine = hierarchy.spine_present(out, (req.hierarchy or {}).get("spine") or [])
    if req.at_step is None and req.level and req.level != hierarchy.RAW and spine:
        levels, _ = hierarchy.materialize_levels(
            out, sch, spine, (req.hierarchy or {}).get("fn"), [])
        out, sch = hierarchy.resolve_level(levels, req.level)
    if req.at_step is None and req.collapse is not None and req.grain is not None and spine:
        # materialize_plan needs the `id` provenance column; a session table
        # carries one, but a caller-supplied raw table may not — inject it (same
        # idiom as /table) so the grain fetch works either way.
        if "id" not in out.columns:
            out = out.copy()
            out.insert(0, "id", [str(i + 1) for i in range(len(out))])
        gmats = hierarchy.materialize_plan(out, sch, req.collapse, [])
        if req.grain in gmats:
            out, sch = gmats[req.grain]
    out = out.drop(columns=["row_ids"], errors="ignore")
    return {"preview": _to_table(out.head(PREVIEW_CAP), sch),
            "n_total": int(len(out)),
            "trace": trace,
            "summary": _column_summary(out, sch)}


@app.post("/shape_counts")
def shape_counts(req: ShapeCountsRequest):
    """Row x column counts for every explorer node in one call: the source
    (pre-step raw table), the table after each step prefix, and each spine
    collapse level. Same slicing/materialize path as /reduce; drives the
    per-node counts in the transformation explorer."""
    table = _resolve_table(req.table, req.table_token)
    df, schema = _load_frame(table)

    def _cols(frame):
        # user-facing column count: exclude the internal provenance columns
        # (`id`, `row_ids`) so it matches what the data-tab grid renders.
        return len([c for c in frame.columns if c not in ("id", "row_ids")])

    # array-shape descriptor spine: filtered to the columns each frame actually
    # carries by describe_shape, so one spine computed from the raw df suffices
    # for the source + step nodes (built before `full`/`present` exist below).
    spine = hierarchy.spine_present(df, (req.hierarchy or {}).get("spine") or [])

    src, src_sch, _ = reduce_mod.reduce_with_trace(df, schema, [])
    out_source = {"rows": int(len(src)), "cols": _cols(src),
                  **shape_mod.describe_shape(src, src_sch, spine)}

    # One incremental fold over the steps instead of re-running every prefix from
    # scratch: this endpoint was O(n²) in the pipeline length (each node re-applied
    # all prior steps). `iter_reduction` yields the same per-prefix frame the old
    # `reduce_with_trace(steps[:i+1])` produced, so the counts are unchanged.
    steps_counts = []
    try:
        for out, _sch, _ in reduce_mod.iter_reduction(df, schema, req.steps):
            steps_counts.append({"rows": int(len(out)), "cols": _cols(out),
                                 **shape_mod.describe_shape(out, _sch, spine)})
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e

    # per-join right-table descriptor: the join's right input rides inline on the
    # step (step.right = {schema, rows}); describe its SOURCE shape (its own
    # identifier columns as the spine) for the binary-join node the UI draws. A
    # right sub-pipeline (right.reduce/right.collapse) is NOT spelled out here.
    joins: dict[str, dict] = {}
    for i, st in enumerate(req.steps):
        if st.get("kind") != "join":
            continue
        rblock = st.get("right") or {}
        r_rows = rblock.get("rows") or []
        if not r_rows:
            continue
        r_schema = rblock.get("schema") or {}
        r_df = pd.DataFrame(r_rows)
        r_spine = [c["name"] for c in r_schema.get("columns", [])
                   if c.get("identifier") and c["name"] in r_df.columns]
        joins[str(i)] = {"rows": int(len(r_df)), "cols": _cols(r_df),
                         **shape_mod.describe_shape(r_df, r_schema, r_spine)}

    # materialize_levels needs the canonical `id` provenance column; a raw table
    # carries one through ingestion, so inject it (same idiom as /table) for a
    # caller-supplied table that omits it. It's folded into `row_ids` and never
    # surfaces in the counts below.
    id_df = df
    if "id" not in id_df.columns:
        id_df = id_df.copy()
        id_df.insert(0, "id", [str(i + 1) for i in range(len(id_df))])
    try:
        full, full_sch, _ = reduce_mod.reduce_with_trace(id_df, schema, req.steps)
    except reduce_mod.ReduceError as e:
        raise HTTPException(422, f"reduction failed: {e}") from e
    spine = hierarchy.spine_present(full, (req.hierarchy or {}).get("spine") or [])
    levels_out: dict[str, dict] = {}
    if spine:
        levels, _ = hierarchy.materialize_levels(
            full, full_sch, spine, (req.hierarchy or {}).get("fn"), [])
        for lvl in spine:
            lout, _lsch = hierarchy.resolve_level(levels, lvl)
            levels_out[lvl] = {"rows": int(len(lout)), "cols": _cols(lout)}
    # grain-keyed counts + guards for the routing graph (un-forcing the nesting).
    # `present` is the same spine_present(full, …) computed for `spine` above —
    # alias it rather than recompute.
    present = spine
    plan = req.collapse or hierarchy.default_plan(present, (req.hierarchy or {}).get("fn") or {})
    grains: dict[str, dict] = {}
    guards: dict = {"pseudoreplication": None, "pairing_flip": None,
                    "identity_merge": [], "post_aggregate_derive": [],
                    "join_leaf_key": hierarchy.join_leaf_key(
                        full, full_sch, spine, req.steps)}
    if present:
        gmats = hierarchy.materialize_plan(full, full_sch, plan, [])
        for key, (gdf, _gsch) in gmats.items():
            grains[key] = {"rows": int(len(gdf)), "cols": _cols(gdf),
                           **shape_mod.describe_shape(gdf, _gsch, present)}
        coarsest = hierarchy._coarsest_grain(gmats)
        test_grain = req.test_grain if req.test_grain is not None else coarsest
        guards["pseudoreplication"] = hierarchy.pseudoreplication(full, plan, test_grain)
        guards["identity_merge"] = hierarchy.identity_merge(full, full_sch, present, plan)
        guards["post_aggregate_derive"] = hierarchy.post_aggregate_derive(
            req.post, test_grain)
        if req.qualifier:
            guards["pairing_flip"] = hierarchy.pairing_flip(
                full, present, req.qualifier, coarsest, test_grain)
    return {"source": out_source, "steps": steps_counts,
            "levels": levels_out, "grains": grains, "joins": joins, "guards": guards}


@app.post("/hierarchy")
def hierarchy_describe(req: HierarchyRequest):
    """Describe the data hierarchy for the Data-tab editor: per-level grain
    cardinalities and where each classifier attaches (its home level). Reuses the
    same home-level logic that drives pairing, so the visualization and the
    inference basis can't disagree."""
    table = _resolve_table(req.table, req.table_token)
    df, schema = _load_frame(table)
    return hierarchy.describe_hierarchy(df, req.spine, req.classifiers)


@app.post("/export")
def export(req: ExportRequest):
    if req.format not in ("svg", "pdf", "png"):
        raise HTTPException(400, "format must be svg, pdf, or png")
    data_id = _table_identity(req.table, req.table_token)
    fig, _, _, _, _, _ = _run(
        lambda: _resolve_table(req.table, req.table_token), req.spec, data_id)
    data = compiler.figure_to_bytes(fig, req.format, dpi=req.dpi)
    compiler.close(fig)
    return {"filename": f"figure.{req.format}",
            "data_base64": base64.b64encode(data).decode()}


@app.post("/export/methods")
def export_methods(req: ExportMethodsRequest):
    """Assemble a methods paragraph + statistics table across the whole document.
    Runs each analysis to get its fresh stats (the numbers can't disagree with the
    figure), then formats via the pure `methods` module. An analysis whose spec
    can't render (e.g. no Y mapping yet) has no method to report and is skipped."""
    if req.format not in ("md", "csv"):
        raise HTTPException(400, "format must be md or csv")
    resolved = _resolve_save_tables(req.tables)
    computed = []
    for spec in req.analyses:
        tbl = resolved.get(spec.get("table_id"))
        if tbl is None:
            continue
        try:
            fig, res, _, _, model, _ = _run(
                lambda t=tbl: {"schema": t["schema"], "rows": t["rows"]}, spec)
        except HTTPException:
            continue      # an incomplete/unrenderable analysis: nothing to report
        compiler.close(fig)
        computed.append({"title": spec.get("title") or "Analysis", "spec": spec,
                         "stats": _json_safe(res), "stat_model": model})
    manifest = {"engine": build_info.build_identity(),
                "engine_snapshot": engine_snapshot()}
    if req.format == "csv":
        text, filename = methods_mod.stats_csv(computed), "statistics.csv"
    else:
        text = methods_mod.methods_markdown(computed, manifest)
        filename = "methods.md"
    return {"filename": filename,
            "data_base64": base64.b64encode(text.encode()).decode()}


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
        data, token = _resolve_import_bytes(req.file_token, req.data_base64)
        df, resolved = _import_frame(data, token, req.filename, req.options, sample=True)
        return importer.preview_headers_from_frame(df, resolved, req.options)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read file: {e}") from e


@app.post("/import/preview")
def import_preview(req: ImportPreviewRequest):
    try:
        data, token = _resolve_import_bytes(req.file_token, req.data_base64)
        df, resolved = _import_frame(data, token, req.filename, req.options)
        return importer.preview_from_frame(df, resolved, req.options)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read file: {e}") from e


@app.post("/import/commit")
def import_commit(req: ImportCommitRequest):
    try:
        data, token = _resolve_import_bytes(req.file_token, req.data_base64)
        df, resolved = _import_frame(data, token, req.filename, req.options)
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


def _resolve_save_tables(save_tables: list[SaveTable]) -> dict:
    """Each requested table resolves to its FULL rows (never a preview window):
    a session yields a `frame` we serialize here; an inline request carries
    `rows`. Save is rare, so paying the frame->rows serialization here is fine.
    Shared by /document/save and the autosave data tier."""
    tables = {}
    for st in save_tables:
        if st.name in tables:
            raise HTTPException(
                422, f"duplicate table name in save request: {st.name}")
        t = _resolve_table(st.table, st.table_id)
        rows = t["rows"] if "rows" in t else session_mod.records(t["frame"])
        tables[st.name] = {"schema": t["schema"], "hierarchy": st.hierarchy,
                           "rows": rows}
    return tables


def _document_response(doc: dict) -> dict:
    """Bring a loaded document dict live: one session per named table, each
    returning its first window. The analyses/provenance carry their own table
    refs and ride back untouched. A document IS its full table set, so the
    store must hold them all at once — raise the LRU bound to fit before the
    create burst, else the earliest tables of a >maxlen document evict before
    this loop returns their (now dead) ids. Shared by /document/load and
    /autosave/restore."""
    _SESSIONS.ensure_capacity(len(doc["tables"]))
    out = []
    for name, t in doc["tables"].items():
        tid = _SESSIONS.create(t["schema"], frame_from_table(t))
        sess = _SESSIONS.get(tid)
        out.append({"name": name, "id": tid, "schema": t["schema"],
                    "hierarchy": t["hierarchy"], "n": sess.n,
                    "version": sess.version, "counts": sess.counts(),
                    "rows": sess.window(0, 200)})  # first window only
    return {"manifest": doc["manifest"], "analyses": doc["analyses"],
            "provenance": doc["provenance"], "tables": out}


@app.post("/document/save")
def doc_save(req: SaveRequest):
    data = document.save_document(_resolve_save_tables(req.tables),
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
    return _document_response(doc)


# ----- autosave / crash recovery (see iris_engine/autosave.py) -----


@app.post("/autosave/snapshot")
async def autosave_snapshot(request: Request):
    # Parsed by hand instead of a Pydantic body so the page-close flush can
    # POST as text/plain — a CORS "simple request" with no preflight to
    # complete while the page is being torn down.
    try:
        req = AutosaveRequest(**json.loads(await request.body()))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"malformed autosave request: {e}") from e

    def iris_bytes() -> bytes:
        # Only reached when the data tier is stale — the common spec-only
        # snapshot never touches the sessions.
        return document.save_document(_resolve_save_tables(req.tables),
                                      req.analyses, req.provenance,
                                      engine_snapshot())

    res = autosave.write_snapshot(
        autosave.default_dir(),
        analyses=req.analyses,
        table_meta=[{"name": st.name, "hierarchy": st.hierarchy}
                    for st in req.tables],
        provenance=req.provenance,
        fingerprint=req.data_fingerprint,
        iris_bytes=iris_bytes)
    return {"ok": True, **res}


@app.get("/autosave/status")
def autosave_status():
    return autosave.status(autosave.default_dir())


@app.post("/autosave/restore")
def autosave_restore():
    try:
        doc = autosave.load_snapshot(autosave.default_dir())
    except FileNotFoundError:
        raise HTTPException(404, "no autosave snapshot") from None
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read autosave snapshot: {e}") from e
    return _document_response(doc)


@app.post("/autosave/clear")
def autosave_clear():
    autosave.clear(autosave.default_dir())
    return {"ok": True}


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
    import uvicorn
    if os.environ.get("IRIS_WATCH_STDIN") == "1":
        threading.Thread(target=_exit_when_stdin_closes, daemon=True).start()
    port = int(os.environ.get("ENGINE_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
