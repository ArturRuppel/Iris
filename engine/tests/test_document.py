"""`.iris` document format: a saved file stamps the engine identity into the
manifest (so its computed results are reproducible) and keeps the library
snapshot as a secondary record."""
import io
import json
import zipfile

from iris_engine import document

SCHEMA = {"schema_version": "1.0",
          "columns": [{"name": "g", "type": "categorical", "label": "G",
                       "levels": ["a", "b"]},
                      {"name": "y", "type": "numeric", "label": "Y"}]}
ROWS = [{"id": "1", "g": "a", "y": 1.0}, {"id": "2", "g": "b", "y": 2.0}]
PROV = {"title": "t"}


def _manifest(data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return json.loads(z.read("manifest.json"))


def test_format_version_is_2_0():
    data = document.save_document(SCHEMA, ROWS, [], PROV, {"scipy": "1.0"})
    assert _manifest(data)["format_version"] == "2.0"


def test_manifest_carries_engine_identity():
    data = document.save_document(SCHEMA, ROWS, [], PROV, {"scipy": "1.0"})
    eng = _manifest(data)["engine"]
    assert set(eng) == {"version", "commit", "dirty"}
    assert isinstance(eng["commit"], str) and eng["commit"]


def test_library_snapshot_retained_as_secondary():
    data = document.save_document(SCHEMA, ROWS, [], PROV, {"scipy": "9.9"})
    assert _manifest(data)["engine_snapshot"] == {"scipy": "9.9"}


def test_round_trips_through_load():
    data = document.save_document(SCHEMA, ROWS, [], PROV, {"scipy": "1.0"})
    doc = document.load_document(data)
    assert doc["manifest"]["engine"]["commit"]
    assert doc["rows"] == ROWS
