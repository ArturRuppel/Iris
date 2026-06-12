"""Document format: a ZIP of human-readable parts (manifest, CSV, JSON)."""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone

import pandas as pd

FORMAT_VERSION = "1.0"


def save_document(schema: dict, rows: list[dict], analyses: list[dict],
                  provenance: dict, engine_snapshot: dict) -> bytes:
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps({
            "format_version": FORMAT_VERSION,
            "modified": datetime.now(timezone.utc).isoformat(),
            "engine_snapshot": engine_snapshot,
        }, indent=2))
        z.writestr("data/table.csv", df.to_csv(index=False))
        z.writestr("data/schema.json", json.dumps(schema, indent=2))
        for i, an in enumerate(analyses, 1):
            z.writestr(f"analyses/{i:02d}-{an.get('id', 'analysis')}.json",
                       json.dumps(an, indent=2))
        z.writestr("provenance.json", json.dumps(provenance, indent=2))
    return buf.getvalue()


def load_document(data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        manifest = json.loads(z.read("manifest.json"))
        if manifest.get("format_version", "0") > FORMAT_VERSION:
            raise ValueError("document was saved by a newer version")
        schema = json.loads(z.read("data/schema.json"))
        df = pd.read_csv(io.TextIOWrapper(z.open("data/table.csv")))
        # restore proper missing values and types
        rows = json.loads(df.to_json(orient="records"))
        analyses = [json.loads(z.read(n)) for n in sorted(z.namelist())
                    if n.startswith("analyses/")]
        provenance = json.loads(z.read("provenance.json"))
    return {"manifest": manifest, "schema": schema, "rows": rows,
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
                         "response": resp, "excluded": False})
            i += 1
    return rows
