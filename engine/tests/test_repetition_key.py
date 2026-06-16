"""Item 10: the independent-repetition key defines n.

When stats.repetition_key is set, technical replicates are averaged to one value
per independent unit before the test, so n (and therefore the chosen test and the
summaries) count units, not raw rows. The figure still plots the raw rows — that
is exercised by the e2e/UI; here we pin the engine-side stats contract.
"""
import numpy as np
import pandas as pd

from iris_engine import stats
from iris_engine.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def _df():
    # 2 groups × 3 subjects × 4 technical replicates = 12 rows per group
    rows = []
    rng = np.random.default_rng(0)
    for grp, base in (("ctrl", 10.0), ("drug", 14.0)):
        for subj in range(3):
            for _ in range(4):
                rows.append({"grp": grp, "subject": f"{grp}_s{subj}",
                             "val": base + subj * 0.5 + rng.normal() * 0.3})
    return pd.DataFrame(rows)


def test_rep_key_collapses_n_to_units():
    df = _df()
    raw = stats.group_comparison(df, "grp", "val", levels=["ctrl", "drug"])
    units = stats.group_comparison(df, "grp", "val", levels=["ctrl", "drug"],
                                   rep_key=["subject"])
    assert [s["n"] for s in raw["summaries"]] == [12, 12]
    assert [s["n"] for s in units["summaries"]] == [3, 3]
    assert "independent repetitions" in units["methods_text"]


def test_rep_key_unit_mean_matches_manual_aggregation():
    df = _df()
    res = stats.group_comparison(df, "grp", "val", levels=["ctrl", "drug"],
                                 rep_key=["subject"])
    manual = (df.groupby(["grp", "subject"], as_index=False)["val"].mean()
              .groupby("grp")["val"].mean())
    by_group = {s["group"]: s["mean"] for s in res["summaries"]}
    assert by_group["ctrl"] == manual["ctrl"]
    assert by_group["drug"] == manual["drug"]


def test_describe_groups_honors_rep_key():
    df = _df()
    res = stats.describe_groups(df, "grp", "val", levels=["ctrl", "drug"],
                               rep_key=["subject"])
    assert [s["n"] for s in res["summaries"]] == [3, 3]


def test_analyze_endpoint_threads_repetition_key():
    df = _df()
    schema = {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier", "label": "ID"},
        {"name": "grp", "type": "categorical", "label": "Group",
         "levels": ["ctrl", "drug"]},
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "val", "type": "numeric", "label": "Value"},
    ]}
    rows = [{"id": f"r{i}", **r, "excluded": False}
            for i, r in enumerate(df.to_dict("records"))]
    spec = {
        "spec_version": "2.0", "id": "t", "title": "",
        "data": {"filter": [], "respect_exclusions": True},
        "reduce": {"steps": []},
        "encodings": {"x": {"column": "grp"}, "y": {"column": "val"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "layers": [{"geom": "bar", "params": {}}],
        "stats": {"family": "group_comparison", "test": "welch_t",
                  "chosen_by": "recommendation_accepted", "alpha": 0.05,
                  "repetition_key": ["subject"]},
        "style": {"preset": "demo_default", "overrides": {}},
    }
    r = client.post("/analyze", json={"table": {"schema": schema, "rows": rows},
                                      "spec": spec})
    assert r.status_code == 200, r.text
    summaries = r.json()["stats"]["summaries"]
    assert [s["n"] for s in summaries] == [3, 3]
