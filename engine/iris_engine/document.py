"""Document format (`.iris`): a ZIP of a Parquet table plus human-readable JSON
parts (manifest, schema, analyses, provenance).

The table is Parquet, not CSV: it round-trips dtypes/nulls/floats exactly (no
re-inference on load) and reads ~an order of magnitude faster than parsing text
for the multi-million-cell tables this app handles. The sidecars stay JSON so a
document is still inspectable and git-diffable."""
from __future__ import annotations

import io
import json
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import build_info

# 2.1: the document persists a multi-table workspace — one Parquet per named
# table under `tables/<name>/`. Analyses carry a `table_id`; join steps carry a
# `right_table_id`. Files older than 2.1 are not read (the 2.0 single-inline-table
# `data/` layout was retired once the example gallery was regenerated to 2.1).
# 2.0: manifest gains the `engine` identity block (version/commit/dirty) and the
# stored analysis spec drops its derived stats fields (chosen_by /
# alternatives_offered / assumption_checks / report) — those are recomputed on
# open. See docs/superpowers/specs/2026-06-24-iris-file-format-redesign-design.md.
FORMAT_VERSION = "2.1"


def save_document(tables: dict, analyses: list[dict],
                  provenance: dict, engine_snapshot: dict) -> bytes:
    """Write a self-contained multi-table `.iris`.

    `tables` is `{name -> {"schema": dict, "hierarchy": dict, "rows": list[dict]}}`;
    each table is stored once under `tables/<name>/`."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps({
            "format_version": FORMAT_VERSION,
            "modified": datetime.now(timezone.utc).isoformat(),
            # the engine that produced this file: pins Iris's decision logic by
            # commit, making every computed value reproducible. `engine_snapshot`
            # (library versions) stays as a secondary, human-readable record.
            "engine": build_info.build_identity(),
            "engine_snapshot": engine_snapshot,
        }, indent=2))
        for name, t in tables.items():
            pq = io.BytesIO()
            pd.DataFrame(t["rows"]).to_parquet(
                pq, index=False, engine="pyarrow", compression="zstd")
            # Parquet is already zstd-compressed; store it raw rather than waste
            # CPU re-deflating incompressible bytes.
            z.writestr(f"tables/{name}/table.parquet", pq.getvalue(),
                       compress_type=zipfile.ZIP_STORED)
            z.writestr(f"tables/{name}/schema.json",
                       json.dumps(t["schema"], indent=2))
            z.writestr(f"tables/{name}/hierarchy.json",
                       json.dumps(t.get("hierarchy", {"spine": [], "fn": {}}),
                                  indent=2))
        for i, an in enumerate(analyses, 1):
            z.writestr(f"analyses/{i:02d}-{an.get('id', 'analysis')}.json",
                       json.dumps(an, indent=2))
        z.writestr("provenance.json", json.dumps(provenance, indent=2))
    return buf.getvalue()


def _version_tuple(v: str) -> tuple[int, ...]:
    """Parse a dotted version to ints so "10.0" > "2.0" compares numerically
    (a plain string compare would order them lexicographically)."""
    try:
        return tuple(int(p) for p in str(v).split("."))
    except ValueError:
        return (0,)


def load_document(data: bytes) -> dict:
    """Read a `.iris` into `{"manifest", "tables", "analyses", "provenance"}`,
    where `tables` is `{name -> {"schema", "hierarchy", "rows"}}`. Tables ride
    under `tables/<name>/` (2.1+)."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        manifest = json.loads(z.read("manifest.json"))
        ver = _version_tuple(manifest.get("format_version", "0"))
        if ver > _version_tuple(FORMAT_VERSION):
            raise ValueError("document was saved by a newer version")
        if ver < _version_tuple("2.1"):
            raise ValueError("document predates the 2.1 multi-table format")
        names = z.namelist()
        analyses = [json.loads(z.read(n)) for n in sorted(names)
                    if n.startswith("analyses/")]
        provenance = json.loads(z.read("provenance.json"))
        tables = {}
        tnames = sorted({n.split("/")[1] for n in names
                         if n.startswith("tables/")})
        for name in tnames:
            df = pd.read_parquet(
                io.BytesIO(z.read(f"tables/{name}/table.parquet")),
                engine="pyarrow")
            tables[name] = {
                "schema": json.loads(z.read(f"tables/{name}/schema.json")),
                "hierarchy": json.loads(z.read(f"tables/{name}/hierarchy.json")),
                "rows": json.loads(df.to_json(orient="records")),
            }
    return {"manifest": manifest, "tables": tables,
            "analyses": analyses, "provenance": provenance}


# ----- sample dataset (mirrors the tier-0 demo's shape) -----

SAMPLE_SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "treatment", "type": "categorical", "label": "Treatment",
         "levels": ["control", "drug_a"]},
        {"name": "dose", "type": "numeric", "label": "Dose (µM)", "unit": "µM"},
        {"name": "response", "type": "numeric", "label": "Cell viability (%)",
         "unit": "%"},
    ],
}


def sample_rows() -> list[dict]:
    import numpy as np
    rng = np.random.default_rng(42)
    rows, i = [], 1
    for treatment in ("control", "drug_a"):
        for _ in range(20):
            dose = round(float(rng.uniform(0, 50)), 1)
            shift = -9 if treatment == "drug_a" else 0
            resp = round(82 - 0.32 * dose + shift + float(rng.normal(0, 6.5)), 1)
            rows.append({"id": f"r{i}", "subject": f"S{i:02d}",
                         "treatment": treatment, "dose": dose,
                         "response": resp})
            i += 1
    return rows


# ----- wide real-world sample (cells_by_frame): drives the reduction pipeline -----

# the repo-root dataset (gitignored, present on dev machines); override with
# IRIS_SAMPLE_CSV, and fall back to the synthetic sample when absent.
DEFAULT_SAMPLE_CSV = str(Path(__file__).resolve().parents[2] / "cells_by_frame.csv")
# columns to treat as identifiers even though they parse as numbers/strings
_ID_COLS = {"cell_id"}
_CAT_MAX_CARD = 50  # object columns with <= this many distinct values -> categorical


def _leaf_label(name: str) -> str:
    return name.split(".")[-1].replace("_", " ")


def _infer_schema(df: pd.DataFrame) -> dict:
    cols = []
    for name in df.columns:
        if name == "id":
            continue
        s = df[name]
        nun = int(s.nunique(dropna=True))
        if name in _ID_COLS or name.endswith("_id") and pd.api.types.is_integer_dtype(s):
            ctype = "identifier"
        elif pd.api.types.is_numeric_dtype(s):
            ctype = "numeric"
        elif nun <= _CAT_MAX_CARD:
            ctype = "categorical"
        else:
            ctype = "identifier"
        col = {"name": name, "type": ctype, "label": _leaf_label(name)}
        if ctype == "categorical":
            col["levels"] = sorted(str(v) for v in s.dropna().unique())
        cols.append(col)
    return {"schema_version": "1.0", "columns": cols}


def load_sample() -> dict:
    """Serve the wide cells_by_frame dataset as the sample table. Falls back to
    the small synthetic dataset if the CSV is not present (e.g. CI, other
    machines). Override the path with IRIS_SAMPLE_CSV."""
    path = Path(os.environ.get("IRIS_SAMPLE_CSV", DEFAULT_SAMPLE_CSV))
    if not path.exists():
        return {"schema": SAMPLE_SCHEMA, "rows": sample_rows()}
    df = pd.read_csv(path)
    schema = _infer_schema(df)
    rows = json.loads(df.to_json(orient="records"))
    for i, r in enumerate(rows, 1):
        r["id"] = str(i)
    return {"schema": schema, "rows": rows}
