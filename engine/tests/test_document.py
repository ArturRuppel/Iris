"""`.iris` document format: a saved file stamps the engine identity into the
manifest (so its computed results are reproducible) and keeps the library
snapshot as a secondary record. The 2.1 layout stores one parquet per named
table (de-duplicated multi-table workspace); 2.0 files (single inline table)
still load via a legacy migration to a one-entry pool."""
import io
import json
import zipfile

import pandas as pd

from iris_engine import document

SCHEMA = {"schema_version": "1.0",
          "columns": [{"name": "g", "type": "categorical", "label": "G",
                       "levels": ["a", "b"]},
                      {"name": "y", "type": "numeric", "label": "Y"}]}
ROWS = [{"id": "1", "g": "a", "y": 1.0}, {"id": "2", "g": "b", "y": 2.0}]
PROV = {"title": "t"}


def _tables(schema=SCHEMA, rows=ROWS, name="table_1", hierarchy=None):
    return {name: {"schema": schema,
                   "hierarchy": hierarchy or {"spine": [], "fn": {}},
                   "rows": rows}}


def _manifest(data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return json.loads(z.read("manifest.json"))


def _legacy_2_0_bytes(schema: dict, rows: list[dict],
                      analyses: list[dict]) -> bytes:
    """Emit the OLD 2.0 layout directly so the legacy branch of load_document is
    exercised: manifest (format_version 2.0), data/table.parquet, data/schema.json,
    analyses/NN-id.json, provenance.json."""
    table = io.BytesIO()
    pd.DataFrame(rows).to_parquet(table, index=False, engine="pyarrow",
                                  compression="zstd")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps({"format_version": "2.0"}))
        z.writestr("data/table.parquet", table.getvalue(),
                   compress_type=zipfile.ZIP_STORED)
        z.writestr("data/schema.json", json.dumps(schema))
        for i, an in enumerate(analyses, 1):
            z.writestr(f"analyses/{i:02d}-{an.get('id', 'analysis')}.json",
                       json.dumps(an))
        z.writestr("provenance.json", json.dumps({}))
    return buf.getvalue()


def test_format_version_is_2_1():
    data = document.save_document(_tables(), [], PROV, {"scipy": "1.0"})
    assert _manifest(data)["format_version"] == "2.1"


def test_manifest_carries_engine_identity():
    data = document.save_document(_tables(), [], PROV, {"scipy": "1.0"})
    eng = _manifest(data)["engine"]
    assert set(eng) == {"version", "commit", "dirty"}
    assert isinstance(eng["commit"], str) and eng["commit"]


def test_library_snapshot_retained_as_secondary():
    data = document.save_document(_tables(), [], PROV, {"scipy": "9.9"})
    assert _manifest(data)["engine_snapshot"] == {"scipy": "9.9"}


def test_round_trips_through_load():
    data = document.save_document(_tables(), [], PROV, {"scipy": "1.0"})
    doc = document.load_document(data)
    assert doc["manifest"]["engine"]["commit"]
    assert doc["tables"]["table_1"]["rows"] == ROWS


# ----- 2.1 multi-table layout -----

S = {"schema_version": "1.0",
     "columns": [{"name": "k", "type": "identifier", "label": "K"}]}


def test_save_writes_one_parquet_per_named_table():
    tables = {
        "cells": {"schema": S, "hierarchy": {"spine": ["k"], "fn": {}}, "rows": [{"id": "1", "k": "a"}]},
        "annot": {"schema": S, "hierarchy": {"spine": [], "fn": {}},   "rows": [{"id": "1", "k": "a"}]},
    }
    data = document.save_document(tables, [{"id": "an1", "table_id": "cells"}], {}, {})
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set(z.namelist())
        assert "tables/cells/table.parquet" in names
        assert "tables/cells/schema.json" in names
        assert "tables/cells/hierarchy.json" in names
        assert "tables/annot/table.parquet" in names
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["format_version"] == "2.1"


def test_load_roundtrips_2_1_tables():
    tables = {"cells": {"schema": S, "hierarchy": {"spine": ["k"], "fn": {}}, "rows": [{"id": "1", "k": "a"}]}}
    data = document.save_document(tables, [{"id": "an1", "table_id": "cells"}], {}, {})
    doc = document.load_document(data)
    assert set(doc["tables"]) == {"cells"}
    assert doc["tables"]["cells"]["rows"] == [{"id": "1", "k": "a"}]
    assert doc["tables"]["cells"]["hierarchy"]["spine"] == ["k"]
    assert doc["analyses"][0]["table_id"] == "cells"


def test_save_then_load_roundtrips_multiple_tables():
    tables = {
        "cells": {"schema": S, "hierarchy": {"spine": ["k"], "fn": {}}, "rows": [{"id": "1", "k": "a"}]},
        "annot": {"schema": S, "hierarchy": {"spine": [],   "fn": {}}, "rows": [{"id": "1", "k": "z"}]},
    }
    doc = document.load_document(document.save_document(tables, [], {}, {}))
    assert set(doc["tables"]) == {"cells", "annot"}
    assert doc["tables"]["cells"]["rows"] == [{"id": "1", "k": "a"}]
    assert doc["tables"]["annot"]["rows"] == [{"id": "1", "k": "z"}]
    assert doc["tables"]["cells"]["hierarchy"]["spine"] == ["k"]
    assert doc["tables"]["annot"]["hierarchy"]["spine"] == []


def test_load_migrates_legacy_2_0_single_table():
    # Build a 2.0 file with the OLD layout, assert load returns a one-entry `tables`.
    legacy = _legacy_2_0_bytes(S, [{"id": "1", "k": "a"}], [{"id": "an1"}])
    doc = document.load_document(legacy)
    assert len(doc["tables"]) == 1
    name = next(iter(doc["tables"]))
    assert doc["tables"][name]["rows"] == [{"id": "1", "k": "a"}]
