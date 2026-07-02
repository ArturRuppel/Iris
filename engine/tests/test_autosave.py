"""Autosave / crash recovery: the two-tier snapshot slot (a standard `.iris`
data tier rewritten only when the data fingerprint moves, plus a spec-state
sidecar rewritten every time) and its /autosave/* endpoints."""
import json

import pytest
from fastapi.testclient import TestClient

from iris_engine import autosave, document
from iris_engine.main import app

client = TestClient(app)

SCHEMA = {"schema_version": "1.0",
          "columns": [{"name": "g", "type": "categorical", "label": "G",
                       "levels": ["a", "b"]},
                      {"name": "y", "type": "numeric", "label": "Y"}]}
ROWS = [{"id": "1", "g": "a", "y": 1.0}, {"id": "2", "g": "b", "y": 2.0}]
HIER = {"spine": [], "fn": {}}
SPEC = {"spec_version": "2.1", "id": "pt_1", "title": "A", "table_id": "t1"}


def _iris_bytes(rows=ROWS, hierarchy=HIER):
    return document.save_document(
        {"t1": {"schema": SCHEMA, "hierarchy": hierarchy, "rows": rows}},
        [SPEC], {}, {"scipy": "1.0"})


def _write(d, *, analyses=None, fingerprint="fp1", hierarchy=HIER,
           iris=None):
    calls = []

    def bytes_fn():
        calls.append(1)
        return iris if iris is not None else _iris_bytes()

    res = autosave.write_snapshot(
        d, analyses=analyses if analyses is not None else [SPEC],
        table_meta=[{"name": "t1", "hierarchy": hierarchy}],
        provenance={}, fingerprint=fingerprint, iris_bytes=bytes_fn)
    return res, len(calls)


# ---- module: slot lifecycle ----

def test_empty_dir_reads_as_no_snapshot(tmp_path):
    assert autosave.status(tmp_path) == {
        "exists": False, "written": None, "n_analyses": 0, "tables": []}


def test_write_then_status(tmp_path):
    res, calls = _write(tmp_path)
    assert res["data_written"] and calls == 1
    st = autosave.status(tmp_path)
    assert st["exists"] and st["n_analyses"] == 1 and st["tables"] == ["t1"]
    assert st["written"]  # ISO timestamp


def test_same_fingerprint_skips_the_data_tier(tmp_path):
    _write(tmp_path)
    spec2 = {**SPEC, "title": "renamed"}
    res, calls = _write(tmp_path, analyses=[SPEC, spec2])
    # data tier untouched (the callable was never invoked)…
    assert not res["data_written"] and calls == 0
    # …but the sidecar's newer analyses win on load.
    doc = autosave.load_snapshot(tmp_path)
    assert [a["title"] for a in doc["analyses"]] == ["A", "renamed"]


def test_changed_fingerprint_rewrites_the_data_tier(tmp_path):
    _write(tmp_path)
    rows2 = ROWS + [{"id": "3", "g": "a", "y": 3.0}]
    res, calls = _write(tmp_path, fingerprint="fp2",
                        iris=_iris_bytes(rows=rows2))
    assert res["data_written"] and calls == 1
    assert len(autosave.load_snapshot(tmp_path)["tables"]["t1"]["rows"]) == 3


def test_missing_iris_forces_a_data_rewrite(tmp_path):
    _write(tmp_path)
    (tmp_path / autosave.SNAPSHOT_IRIS).unlink()
    assert autosave.status(tmp_path)["exists"] is False  # half a slot ≠ a slot
    res, _ = _write(tmp_path)  # same fingerprint, but the file is gone
    assert res["data_written"]


def test_sidecar_hierarchy_overlays_the_iris(tmp_path):
    # a spine reorder doesn't bump the session version (same fingerprint), so
    # it must ride the sidecar and win over the .iris's stored hierarchy.
    _write(tmp_path)
    newh = {"spine": ["g"], "fn": {"g": "median"}}
    _write(tmp_path, hierarchy=newh)
    assert autosave.load_snapshot(tmp_path)["tables"]["t1"]["hierarchy"] == newh


def test_clear_empties_the_slot(tmp_path):
    _write(tmp_path)
    autosave.clear(tmp_path)
    assert autosave.status(tmp_path)["exists"] is False
    with pytest.raises(FileNotFoundError):
        autosave.load_snapshot(tmp_path)
    autosave.clear(tmp_path)  # clearing an empty slot is a no-op, not an error


def test_corrupt_sidecar_reads_as_no_snapshot(tmp_path):
    _write(tmp_path)
    (tmp_path / autosave.STATE_JSON).write_text("{not json")
    assert autosave.status(tmp_path)["exists"] is False


def test_default_dir_honors_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("IRIS_AUTOSAVE_DIR", str(tmp_path / "slot"))
    assert autosave.default_dir() == tmp_path / "slot"


# ---- endpoints: snapshot → status → restore → clear ----

def _snapshot_req(fingerprint="fp1", analyses=None):
    return {"tables": [{"name": "t1", "table": {"schema": SCHEMA, "rows": ROWS},
                        "hierarchy": HIER}],
            "analyses": analyses if analyses is not None else [SPEC],
            "provenance": {}, "data_fingerprint": fingerprint}


def test_endpoint_round_trip(monkeypatch, tmp_path):
    monkeypatch.setenv("IRIS_AUTOSAVE_DIR", str(tmp_path))
    r = client.post("/autosave/snapshot", json=_snapshot_req())
    assert r.status_code == 200 and r.json()["data_written"] is True

    st = client.get("/autosave/status").json()
    assert st["exists"] and st["tables"] == ["t1"] and st["n_analyses"] == 1

    doc = client.post("/autosave/restore").json()
    assert [t["name"] for t in doc["tables"]] == ["t1"]
    assert doc["tables"][0]["n"] == 2          # a live session was created
    assert doc["analyses"] == [SPEC]

    assert client.post("/autosave/clear").json() == {"ok": True}
    assert client.get("/autosave/status").json()["exists"] is False
    assert client.post("/autosave/restore").status_code == 404


def test_endpoint_accepts_text_plain_body(monkeypatch, tmp_path):
    # the page-close flush posts as text/plain (a CORS simple request — no
    # preflight to complete during unload); the endpoint must parse it anyway.
    monkeypatch.setenv("IRIS_AUTOSAVE_DIR", str(tmp_path))
    r = client.post("/autosave/snapshot", content=json.dumps(_snapshot_req()),
                    headers={"Content-Type": "text/plain"})
    assert r.status_code == 200
    assert client.get("/autosave/status").json()["exists"] is True


def test_endpoint_spec_only_snapshot_keeps_data_tier(monkeypatch, tmp_path):
    monkeypatch.setenv("IRIS_AUTOSAVE_DIR", str(tmp_path))
    client.post("/autosave/snapshot", json=_snapshot_req())
    spec2 = {**SPEC, "title": "edited"}
    r = client.post("/autosave/snapshot",
                    json=_snapshot_req(analyses=[spec2]))
    assert r.json()["data_written"] is False
    doc = client.post("/autosave/restore").json()
    assert doc["analyses"][0]["title"] == "edited"


def test_endpoint_malformed_body_is_422(monkeypatch, tmp_path):
    monkeypatch.setenv("IRIS_AUTOSAVE_DIR", str(tmp_path))
    assert client.post("/autosave/snapshot", content="{nope").status_code == 422
