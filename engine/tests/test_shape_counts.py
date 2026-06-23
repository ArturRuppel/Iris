from fastapi.testclient import TestClient
from iris_engine.main import app

client = TestClient(app)

def _fixture():
    rows = []
    for g in ("ctrl", "drug"):
        for s in range(3):
            for r in range(3):
                rows.append({"group": g, "subject": f"{g}_s{s}", "rep": r, "value": 1.0 + s + r})
    schema = {"schema_version": "1.0", "columns": [
        {"name": "group", "label": "Group", "type": "classifier"},
        {"name": "subject", "label": "Subject", "type": "identifier"},
        {"name": "rep", "label": "Rep", "type": "identifier"},
        {"name": "value", "label": "Value", "type": "numeric"}]}
    return {"schema": schema, "rows": rows}

def test_shape_counts_source_steps_levels():
    table = _fixture()
    body = {
        "table": table,
        "steps": [
            {"kind": "filter", "conditions": [{"column": "value", "op": ">", "value": 0}]},
            {"kind": "drop", "columns": ["value"]},
        ],
        "hierarchy": {"spine": ["subject", "rep"], "fn": {}},
    }
    r = client.post("/shape_counts", json=body)
    assert r.status_code == 200
    d = r.json()
    assert d["source"] == {"rows": 18, "cols": 4}
    assert d["steps"] == [{"rows": 18, "cols": 4}, {"rows": 18, "cols": 3}]
    assert d["levels"]["subject"]["rows"] == 6
    assert d["levels"]["rep"]["rows"] == 18

def test_shape_counts_no_spine_no_levels():
    table = _fixture()
    r = client.post("/shape_counts", json={"table": table, "steps": [], "hierarchy": {"spine": [], "fn": {}}})
    assert r.status_code == 200
    assert r.json()["levels"] == {}
    assert r.json()["steps"] == []
    assert r.json()["source"]["rows"] == 18
