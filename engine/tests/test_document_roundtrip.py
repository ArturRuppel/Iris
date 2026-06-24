"""Full save -> load -> analyze round trip through the HTTP handlers, proving a
2.1 .iris stores decisions only and the engine re-derives the computed layer from
them on open (the format-redesign contract)."""
import pandas as pd
from fastapi.testclient import TestClient

from iris_engine.main import app

client = TestClient(app)

A = [72.1, 68.4, 75.3, 80.2, 69.9, 77.5, 74.0, 71.2, 66.8, 79.1]
B = [61.2, 58.7, 65.1, 55.9, 63.4, 60.8, 57.2, 64.0, 59.5, 62.3]


def _table():
    rows = []
    for i, v in enumerate(A, 1):
        rows.append({"id": f"a{i}", "treatment": "control", "response": v})
    for i, v in enumerate(B, 1):
        rows.append({"id": f"b{i}", "treatment": "drug_a", "response": v})
    schema = {"schema_version": "1.0", "columns": [
        {"name": "treatment", "type": "categorical", "label": "Treatment",
         "levels": ["control", "drug_a"]},
        {"name": "response", "type": "numeric", "label": "Response"}]}
    return {"schema": schema, "rows": rows}


def _spec(**stats_extra):
    return {
        "spec_version": "2.1", "id": "rt-01", "title": "Round trip",
        "data": {"filter": []}, "reduce": {"steps": []},
        "encodings": {"x": {"column": "treatment"}, "y": {"column": "response"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": [], "fn": {}},
        "layers": [{"geom": "box", "params": {}}],
        "stats": {"family": "group_comparison", "test": "welch_t", "alpha": 0.05,
                  **stats_extra},
        "annotations": {"significance_brackets": "auto", "show_n": True},
        "style": {"overrides": {}}, "engine_snapshot": {},
    }


def _save_then_load(spec):
    save = client.post("/document/save", json={
        "table": _table(), "analyses": [spec], "provenance": {"title": "t"}})
    assert save.status_code == 200, save.text
    data_b64 = save.json()["data_base64"]
    load = client.post("/document/load", json={"data_base64": data_b64})
    assert load.status_code == 200, load.text
    return load.json()


def test_manifest_carries_engine_identity_after_load():
    doc = _save_then_load(_spec())
    assert doc["manifest"]["engine"]["commit"]
    assert "engine_snapshot" in doc["manifest"]


def test_override_and_describe_only_survive_round_trip():
    doc = _save_then_load(_spec(override="mann_whitney", describe_only=True))
    st = doc["analyses"][0]["stats"]
    assert st["override"] == "mann_whitney"
    assert st["describe_only"] is True
    # the decisions are stored; the derived/process fields are not.
    for dead in ("chosen_by", "alternatives_offered", "assumption_checks", "report"):
        assert dead not in st


def test_engine_rederives_describe_only_from_the_stored_decision():
    """A describe-only decision loaded from a file makes the engine run no test —
    the computed `chosen_by` is re-derived from the decision, not stored."""
    doc = _save_then_load(_spec(describe_only=True))
    loaded_spec = doc["analyses"][0]
    table = {"schema": doc["schema"], "rows": doc["rows"]}
    res = client.post("/analyze", json={"table": table, "spec": loaded_spec})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert "p" not in body["stats"]["result"]


def test_override_is_honored_after_load():
    doc = _save_then_load(_spec(override="mann_whitney"))
    loaded_spec = doc["analyses"][0]
    table = {"schema": doc["schema"], "rows": doc["rows"]}
    body = client.post("/analyze", json={"table": table, "spec": loaded_spec}).json()
    assert body["stats"]["result"]["test"] == "mann_whitney"
