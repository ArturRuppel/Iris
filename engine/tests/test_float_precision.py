"""Floats survive a document round trip bit-exactly.

`df.to_json` rounds to 10 decimal places by default, so building rows with it
turned 1.23e-12 into 0.0 on load, and the next save (an in-place lab-book save,
an autosave restore) wrote the rounded table back over the exact Parquet one.
These pin the exact path: save -> load -> save-from-session -> load, plus the
reduce preview/export rows (`main._to_table`)."""
import base64
import io
import json
import math
import struct
import zipfile

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from iris_engine import document, main
from iris_engine.main import app

client = TestClient(app)

VALUES = [1.23456789012345e-12, 4.56e-11, 3.14159e-7, 0.1234567890123456,
          6.02214076e23, -2.5e-15, float("nan"), 1.0000000000000002]


def _bits(x):
    return struct.pack("<d", x)


def _assert_exact(got, want):
    assert len(got) == len(want)
    for g, w in zip(got, want):
        if w is None or (isinstance(w, float) and math.isnan(w)):
            assert g is None or (isinstance(g, float) and math.isnan(g)), (g, w)
        else:
            assert _bits(float(g)) == _bits(w), (g, w)


def _table():
    rows = [{"id": f"r{i}", "group": "A" if i % 2 else "B",
             "value": None if math.isnan(v) else v, "count": i}
            for i, v in enumerate(VALUES, 1)]
    schema = {"schema_version": "1.0", "columns": [
        {"name": "group", "type": "categorical", "label": "Group", "levels": ["A", "B"]},
        {"name": "value", "type": "numeric", "label": "Value"},
        {"name": "count", "type": "numeric", "label": "Count"}]}
    return {"schema": schema, "rows": rows}


def _parquet(data_b64, name="table_1"):
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(data_b64))) as z:
        return pd.read_parquet(io.BytesIO(z.read(f"tables/{name}/table.parquet")))


def _save(table=None, table_id=None):
    st = {"name": "table_1", "hierarchy": {"spine": [], "fn": {}}}
    st.update({"table": table} if table is not None else {"table_id": table_id})
    res = client.post("/document/save", json={
        "tables": [st], "analyses": [], "provenance": {"title": "t"}})
    assert res.status_code == 200, res.text
    return res.json()["data_base64"]


def test_load_document_rows_are_exact():
    data = _save(_table())
    _assert_exact(_parquet(data)["value"].tolist(), VALUES)
    doc = document.load_document(base64.b64decode(data))
    rows = doc["tables"]["table_1"]["rows"]
    _assert_exact([r["value"] for r in rows], VALUES)
    assert [r["count"] for r in rows] == list(range(1, len(VALUES) + 1))
    assert all(type(r["count"]) is int for r in rows)
    assert rows[6]["value"] is None                      # NaN -> null, as before
    assert [r["group"] for r in rows][:2] == ["A", "B"]


def test_load_save_load_cycle_is_exact():
    """Load into sessions, save from the session (the lab-book in-place save and
    autosave path), load again: the Parquet table is unchanged."""
    first = _save(_table())
    load = client.post("/document/load", json={"data_base64": first})
    assert load.status_code == 200, load.text
    body = load.json()
    _assert_exact([r["value"] for r in body["tables"][0]["rows"]], VALUES)
    second = _save(table_id=body["tables"][0]["id"])
    a, b = _parquet(first), _parquet(second)
    _assert_exact(b["value"].tolist(), a["value"].tolist())
    assert b["count"].tolist() == a["count"].tolist()
    doc = document.load_document(base64.b64decode(second))
    _assert_exact([r["value"] for r in doc["tables"]["table_1"]["rows"]], VALUES)


def test_to_table_rows_are_exact():
    df = pd.DataFrame({"value": VALUES, "count": np.arange(len(VALUES)),
                       "flag": [True, False] * 4,
                       "when": pd.to_datetime(["2020-01-01"] * 7 + [None]),
                       "cat": pd.Categorical(["x", "y"] * 4)})
    rows = main._to_table(df, {})["rows"]
    rows = json.loads(json.dumps(rows))                  # what the wire carries
    _assert_exact([r["value"] for r in rows], VALUES)
    # everything but float precision is what to_json gave before
    old = json.loads(df.to_json(orient="records"))
    for r, o in zip(rows, old):
        assert {k: v for k, v in r.items() if k != "value"} == \
               {k: v for k, v in o.items() if k != "value"}
    assert rows[0]["when"] == 1577836800000 and rows[7]["when"] is None


def test_json_rows_nonfinite_and_object_floats():
    df = pd.DataFrame({"f": [np.inf, -np.inf, 1e-13],
                       "o": [1e-13, "a", None],
                       "F": pd.array([2.5e-12, None, 1.0], dtype="Float64")})
    rows = document.json_rows(df)
    assert [r["f"] for r in rows] == [None, None, 1e-13]
    assert [r["o"] for r in rows] == [1e-13, "a", None]
    assert [r["F"] for r in rows] == [2.5e-12, None, 1.0]
