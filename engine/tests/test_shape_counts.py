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


def _table():
    cols = ["experiment", "field", "cell", "frame", "area"]
    rows = []
    for e in ("e1", "e2", "e3"):
        for f in ("f1", "f2"):
            for c in range(4):
                for fr in range(5):
                    rows.append([e, f, c, fr, float(len(rows))])
    return {"schema": {"schema_version": "1.0", "columns": [
                {"name": "experiment", "type": "identifier", "label": "Experiment"},
                {"name": "field", "type": "identifier", "label": "Field"},
                {"name": "cell", "type": "identifier", "label": "Cell"},
                {"name": "frame", "type": "numeric", "label": "Frame"},
                {"name": "area", "type": "numeric", "label": "Area"}]},
            "rows": [dict(zip(cols, r)) for r in rows]}

SPINE = ["experiment", "field", "cell", "frame"]

def _default_plan():
    return [{"keep": SPINE[:i], "fn": "median"} for i in range(len(SPINE), 0, -1)]

def test_shape_counts_keys_collapse_nodes_by_grain():
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": _default_plan(), "test_grain": "experiment", "qualifier": None}
    r = client.post("/shape_counts", json=body)
    assert r.status_code == 200
    grains = r.json()["grains"]
    assert grains["experiment"]["rows"] == 3
    assert grains["experiment/field/cell"]["rows"] == 24

def test_shape_counts_returns_guards():
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": _default_plan(), "test_grain": "", "qualifier": None}
    g = client.post("/shape_counts", json=body).json()["guards"]
    assert g["pseudoreplication"]["risk"] is True
    assert g["identity_merge"] == []
