"""HTTP protocol surface. Runs as a localhost sidecar.

Dev mode:   python -m triad_engine.main   (port 8765, or ENGINE_PORT env)
Tauri mode: spawned by the shell at startup.
"""
from __future__ import annotations

import base64
import os
import sys

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import compiler, document, importer, stats

app = FastAPI(title="triad-engine")
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
    table: dict
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


class ImportPreviewRequest(BaseModel):
    filename: str
    data_base64: str
    options: dict = {}


class ImportCommitRequest(ImportPreviewRequest):
    columns: list[dict]


def _prepare(table: dict, spec: dict) -> tuple[pd.DataFrame, dict]:
    schema = table["schema"]
    df = pd.DataFrame(table["rows"])
    n_before = len(df)
    if spec.get("data", {}).get("respect_exclusions", True) and "excluded" in df:
        df = df[~df["excluded"].fillna(False)]
    df = df.copy()
    df.attrs["n_excluded"] = n_before - len(df)
    for col in schema["columns"]:
        if col["type"] == "numeric" and col["name"] in df:
            df[col["name"]] = pd.to_numeric(df[col["name"]], errors="coerce")
    return df, schema


def _run(table: dict, spec: dict):
    df, schema = _prepare(table, spec)
    m = spec["mappings"]
    family = spec["stats"]["family"]
    alpha = spec["stats"].get("alpha", 0.05)
    override = (spec["stats"].get("test")
                if spec["stats"].get("chosen_by") == "user_override" else None)
    if family == "group_comparison":
        xcol = next(c for c in schema["columns"] if c["name"] == m["x"]["column"])
        res = stats.group_comparison(
            df, m["x"]["column"], m["y"]["column"],
            levels=xcol.get("levels", []), alpha=alpha, override=override)
    elif family == "correlation":
        res = stats.correlation(df, m["x"]["column"], m["y"]["column"],
                                alpha=alpha, override=override)
    elif family == "descriptive":
        res = stats.descriptive(df, m["y"]["column"], alpha=alpha)
    else:
        raise HTTPException(400, f"unknown stats family {family!r}")
    if "error" in res:
        raise HTTPException(422, res["error"])
    fig, point_groups = compiler.build_figure(df, schema, spec, res)
    return fig, point_groups, res


@app.get("/health")
def health():
    return {"status": "ok", "engine_snapshot": engine_snapshot()}


@app.get("/sample")
def sample():
    return {"schema": document.SAMPLE_SCHEMA, "rows": document.sample_rows()}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    fig, point_groups, res = _run(req.table, req.spec)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return {"figure": {"svg": svg, "point_groups": point_groups},
            "stats": res, "engine_snapshot": engine_snapshot()}


@app.post("/export")
def export(req: ExportRequest):
    if req.format not in ("svg", "pdf", "png"):
        raise HTTPException(400, "format must be svg, pdf, or png")
    fig, _, _ = _run(req.table, req.spec)
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
    TRIAD_WATCH_STDIN=1; if the shell dies for any reason — including
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
    if os.environ.get("TRIAD_WATCH_STDIN") == "1":
        threading.Thread(target=_exit_when_stdin_closes, daemon=True).start()
    port = int(os.environ.get("ENGINE_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
