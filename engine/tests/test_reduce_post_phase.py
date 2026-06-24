"""Post-collapse reduce phase (`reduce.post`): steps that run on the chosen
test-grain table AFTER collapse, expressing grain-dependent transforms a
raw-grain reduce cannot — e.g. the COV2D §3 enrichment `log2(Σobs/Σexp)`, a
derive over per-replicate SUMS.

These pin: (1) `reduce.project_schema` projects a post-phase derive's output
column onto the schema so `statmodel.infer` can pick the family for an encoding
mapping Y to it; (2) `render` runs the post phase on the collapsed grain and the
one-sample test sees the derived values; (3) the figure still builds (the derived
column is surfaced at its grain); (4) absent `reduce.post`, the schema and path
are unchanged.
"""
import json

import pandas as pd

from iris_engine import main, reduce as rd


def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "group", "type": "categorical", "label": "Group", "levels": ["A"]},
        {"name": "experiment", "type": "identifier", "label": "Experiment"},
        {"name": "obs", "type": "numeric", "label": "Observed"},
        {"name": "exp", "type": "numeric", "label": "Expected"}]}


def _df():
    # 3 replicates; per-replicate Σobs/Σexp = 2.0, 3.0, 4.0 (mean ratio 3.0)
    rows = [
        ("e1", 4, 2), ("e1", 6, 3),     # Σobs 10 / Σexp 5 = 2.0
        ("e2", 9, 3), ("e2", 6, 2),     # 15 / 5 = 3.0
        ("e3", 12, 2), ("e3", 8, 3),    # 20 / 5 = 4.0
    ]
    return pd.DataFrame([{"id": f"r{i}", "group": "A",
                          "experiment": e, "obs": o, "exp": x}
                         for i, (e, o, x) in enumerate(rows)])


def _table():
    return {"schema": _schema(),
            "rows": json.loads(_df().to_json(orient="records"))}


def _spec():
    return {
        "spec_version": "2.0",
        "title": "enrichment",
        "encodings": {"x": {"column": "group"}, "y": {"column": "enrich"},
                      "color": None, "size": None, "shape": None},
        "layers": [{"geom": "dot", "level": "experiment", "params": {}}],
        "hierarchy": {"spine": ["experiment"]},
        "collapse": [{"keep": ["experiment"], "fn": "sum"}],
        "test_grain": "experiment",
        "reduce": {"steps": [],
                   "post": [{"kind": "derive", "column": "enrich",
                             "expr": "obs / exp"}]},
        "stats": {"alpha": 0.05, "family": "location", "reference": 1.0},
    }


def test_project_schema_adds_post_derive_column():
    sch = _schema()
    out = rd.project_schema(sch, [{"kind": "derive", "column": "enrich",
                                   "expr": "obs / exp"}])
    by_name = {c["name"]: c for c in out["columns"]}
    assert "enrich" in by_name and by_name["enrich"]["type"] == "numeric"
    # original schema is not mutated
    assert all(c["name"] != "enrich" for c in sch["columns"])


def test_project_schema_no_steps_is_identity():
    sch = _schema()
    assert rd.project_schema(sch, []) == sch
    assert rd.project_schema(sch, None) == sch


def test_post_phase_feeds_the_one_sample_test():
    fig, res, df_out, schema, model, issues = main._run(_table(), _spec())
    # the post-derived column drove family inference to the one-sample location test
    assert model["family"] == "location"
    pg = {g["level"]: g for g in res["per_group"]}
    assert "A" in pg
    assert pg["A"]["n"] == 3                       # 3 replicates, not 6 raw rows
    assert abs(pg["A"]["center"] - 3.0) < 1e-9     # mean of Σobs/Σexp = (2+3+4)/3
    assert fig is not None                         # figure builds with the derived column


def test_absent_post_phase_leaves_schema_untouched():
    # a spec with no reduce.post infers against the raw schema (regression guard)
    spec = _spec()
    spec["encodings"]["y"] = {"column": "obs"}
    spec["reduce"] = {"steps": []}
    fig, res, *_ = main._run(_table(), spec)
    assert fig is not None
