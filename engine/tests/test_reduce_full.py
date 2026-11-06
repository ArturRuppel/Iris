"""/reduce returns the first PREVIEW_CAP rows by default and every row with full."""
from fastapi.testclient import TestClient
from iris_engine import main

client = TestClient(main.app)
N = main.PREVIEW_CAP + 37
TABLE = {"schema": {"schema_version": "1.0", "columns": [
            {"name": "g", "type": "categorical", "identifier": True},
            {"name": "v", "type": "numeric"}]},
         "rows": [{"g": f"r{i}", "v": float(i)} for i in range(N)]}


def test_preview_is_capped():
    r = client.post("/reduce", json={"table": TABLE, "steps": []}).json()
    assert r["n_total"] == N and len(r["preview"]["rows"]) == main.PREVIEW_CAP


def test_full_returns_every_row():
    r = client.post("/reduce", json={"table": TABLE, "steps": [], "full": True}).json()
    assert r["n_total"] == N and len(r["preview"]["rows"]) == N
