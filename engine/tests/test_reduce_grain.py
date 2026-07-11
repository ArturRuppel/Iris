# engine/tests/test_reduce_grain.py
from fastapi.testclient import TestClient
from iris_engine.main import app
from tests.test_shape_counts import _table, SPINE  # reuse fixture

client = TestClient(app)

def test_reduce_fetches_non_prefix_grain():
    # full spine, then drop cell keeping frame -> grain "experiment/field/frame"
    body = {"table": _table(), "steps": [],
            "hierarchy": {"spine": SPINE, "fn": {}},
            "collapse": [{"keep": ["experiment", "field", "cell", "frame"], "fn": "mean"},
                         {"keep": ["experiment", "field", "frame"], "fn": "mean"}],
            "grain": "experiment/field/frame"}
    r = client.post("/reduce", json=body)
    assert r.status_code == 200
    # 3 experiments x 2 fields x 5 frames = 30 rows
    assert r.json()["n_total"] == 30


def test_reduce_accepts_a_dag_request():
    table = {"schema": {"columns": [{"name": "v", "type": "numeric"}]},
             "rows": [{"v": 1}, {"v": 5}]}
    dag = {"nodes": [
        {"id": "src", "kind": "source", "table": table},
        {"id": "s0", "kind": "step", "inputs": ["src"],
         "step": {"kind": "filter", "conditions": [{"column": "v", "op": ">", "value": 2}]}}],
        "output": "s0"}
    r = client.post("/reduce", json={"reduce": dag})
    assert r.status_code == 200
    assert r.json()["n_total"] == 1
