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


def _table2():
    rows = [{"id": f"w{i}", "well": f"P{i}", "count": float(i)} for i in range(1, 6)]
    schema = {"schema_version": "1.0", "columns": [
        {"name": "well", "type": "categorical", "label": "Well"},
        {"name": "count", "type": "numeric", "label": "Count"}]}
    return {"schema": schema, "rows": rows}


def _save_then_load(spec):
    save = client.post("/document/save", json={
        "tables": [{"name": "table_1", "table": _table(),
                    "hierarchy": {"spine": [], "fn": {}}}],
        "analyses": [spec], "provenance": {"title": "t"}})
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
    table = {"schema": doc["tables"][0]["schema"], "rows": doc["tables"][0]["rows"]}
    res = client.post("/analyze", json={"table": table, "spec": loaded_spec})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert "p" not in body["stats"]["result"]


def test_override_is_honored_after_load():
    doc = _save_then_load(_spec(override="mann_whitney"))
    loaded_spec = doc["analyses"][0]
    table = {"schema": doc["tables"][0]["schema"], "rows": doc["tables"][0]["rows"]}
    body = client.post("/analyze", json={"table": table, "spec": loaded_spec}).json()
    assert body["stats"]["result"]["test"] == "mann_whitney"


def test_save_embeds_several_named_tables():
    """Two sessions, both referenced by id in the save request, land as two named
    tables in the 2.1 file; an analysis references one and a join the other."""
    tid1 = client.post("/table/create", json={"table": _table()}).json()["id"]
    tid2 = client.post("/table/create", json={"table": _table2()}).json()["id"]
    spec = _spec()
    spec["table_id"] = tid1
    spec["reduce"]["steps"] = [{"kind": "join", "right_table_id": tid2}]
    save = client.post("/document/save", json={
        "tables": [
            {"name": "cells", "table_id": tid1, "hierarchy": {"spine": [], "fn": {}}},
            {"name": "wells", "table_id": tid2, "hierarchy": {"spine": [], "fn": {}}},
        ],
        "analyses": [spec], "provenance": {"title": "t"}})
    assert save.status_code == 200, save.text
    assert save.json()["data_base64"]
    load = client.post(
        "/document/load", json={"data_base64": save.json()["data_base64"]})
    assert load.status_code == 200, load.text
    tables = load.json()["tables"]
    assert len(tables) == 2
    assert {t["name"] for t in tables} == {"cells", "wells"}


def test_load_creates_a_session_per_table():
    """Each loaded table comes back as a live session: full per-table keys, and the
    returned id is usable in a follow-up session call. Analyses keep their refs."""
    spec = _spec()
    spec["table_id"] = "table_1"
    spec["reduce"]["steps"] = [{"kind": "join", "right_table_id": "table_2"}]
    save = client.post("/document/save", json={
        "tables": [{"name": "table_1", "table": _table(),
                    "hierarchy": {"spine": [], "fn": {}}}],
        "analyses": [spec], "provenance": {"title": "t"}}).json()
    load = client.post(
        "/document/load", json={"data_base64": save["data_base64"]}).json()
    assert load["tables"]
    for t in load["tables"]:
        assert set(t) >= {"name", "id", "schema", "hierarchy",
                          "n", "version", "counts", "rows"}
        win = client.post(f"/table/{t['id']}/rows", json={"start": 0, "end": 5})
        assert win.status_code == 200, win.text
        assert win.json()["n"] == t["n"]
    a = load["analyses"][0]
    assert a["table_id"] == "table_1"
    assert a["reduce"]["steps"][0]["right_table_id"] == "table_2"


def test_full_rows_persisted_not_just_the_load_window():
    """Save must persist FULL rows, never the 200-row preview window: a >200-row
    table round-trips so the loaded session holds all rows even though the load
    response only carries the first window."""
    rows = [{"id": str(i + 1), "treatment": "control", "response": float(i)}
            for i in range(250)]
    schema = {"schema_version": "1.0", "columns": [
        {"name": "treatment", "type": "categorical", "label": "Treatment",
         "levels": ["control"]},
        {"name": "response", "type": "numeric", "label": "Response"}]}
    tid = client.post(
        "/table/create", json={"table": {"schema": schema, "rows": rows}}
    ).json()["id"]
    saved = client.post("/document/save", json={
        "tables": [{"name": "big", "table_id": tid,
                    "hierarchy": {"spine": [], "fn": {}}}],
        "analyses": [], "provenance": {}}).json()
    load = client.post(
        "/document/load", json={"data_base64": saved["data_base64"]}).json()
    t = load["tables"][0]
    assert t["n"] == 250                       # session knows the full count
    assert len(t["rows"]) == 200               # load response is only first window
    # the live session holds the rest, not just the preview:
    tail = client.post(
        f"/table/{t['id']}/rows", json={"start": 200, "end": 250}).json()
    assert tail["n"] == 250 and len(tail["rows"]) == 50


def test_load_keeps_every_session_of_a_large_document_resident():
    """Regression: a document with more tables than the session-store LRU bound
    (default 8) must come back with EVERY table live — load raises the bound to
    fit before creating the sessions. Before the fix the earliest tables evicted
    before load returned, handing back dead ids (silent data loss on the next
    analyze/save). Tables are saved inline so the >8 save-side cap (a separate,
    documented limitation) doesn't gate this load-path assertion."""
    n = 10  # > the default maxlen of 8
    schema = {"schema_version": "1.0", "columns": [
        {"name": "k", "type": "categorical", "label": "K"},
        {"name": "val", "type": "numeric", "label": "Val"}]}
    tables = [
        {"name": f"t{i}", "hierarchy": {"spine": [], "fn": {}},
         "table": {"schema": schema,
                   "rows": [{"id": f"r{i}_{j}", "k": f"v{j}", "val": float(j)}
                            for j in range(3)]}}
        for i in range(n)
    ]
    save = client.post("/document/save", json={
        "tables": tables, "analyses": [], "provenance": {}})
    assert save.status_code == 200, save.text
    load = client.post(
        "/document/load", json={"data_base64": save.json()["data_base64"]})
    assert load.status_code == 200, load.text
    loaded = load.json()["tables"]
    assert len(loaded) == n
    # every returned id must be a LIVE session — a follow-up rows call proves it.
    for t in loaded:
        win = client.post(f"/table/{t['id']}/rows", json={"start": 0, "end": 5})
        assert win.status_code == 200, f"{t['name']} session is dead: {win.text}"
        assert win.json()["n"] == t["n"]


def test_duplicate_table_name_in_save_is_rejected():
    save = client.post("/document/save", json={
        "tables": [
            {"name": "dup", "table": _table(),
             "hierarchy": {"spine": [], "fn": {}}},
            {"name": "dup", "table": _table2(),
             "hierarchy": {"spine": [], "fn": {}}},
        ],
        "analyses": [], "provenance": {}})
    assert save.status_code == 422, save.text
