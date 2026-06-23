"""Analyze-path routing: a spec may carry an explicit collapse plan and a chosen
test grain. When present, the inferential grain follows `spec["test_grain"]`
(the chosen grain's finest kept dim) rather than the derived coarsest level, and
the stats run on that grain's materialized table.

These pin the wiring in render.render — that an explicit, FINER test_grain
overrides the default `coarsest_level` (which for a subject⊃rep spine would pick
`subject`).
"""
import pandas as pd

from iris_engine import hierarchy, main


def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "group", "type": "categorical", "label": "Group"},
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "rep", "type": "identifier", "label": "Rep"},
        {"name": "y", "type": "numeric", "label": "Y"}]}


def _paired_df():
    rows, rid = [], 0
    for s in ["s1", "s2", "s3"]:
        for grp in ("A", "B"):
            for r in range(3):
                rows.append({"id": f"r{rid}", "group": grp,
                             "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)


def _table(df):
    import json
    return {"schema": _schema(),
            "rows": json.loads(df.to_json(orient="records"))}


def _base_spec():
    return {
        "spec_version": "2.0",
        "title": "t",
        "encodings": {"x": {"column": "group"}, "y": {"column": "y"},
                      "color": None, "size": None, "shape": None},
        "layers": [{"geom": "box", "params": {}}],
        "hierarchy": {"spine": ["subject", "rep"]},
        "stats": {"alpha": 0.05},
    }


def test_explicit_test_grain_overrides_coarsest_level():
    df = _paired_df()
    spec = _base_spec()
    # default plan for the spine: collapse rep→subject; coarsest derived = "subject"
    spec["collapse"] = [
        {"keep": ["subject", "rep"], "fn": "median"},
        {"keep": ["subject"], "fn": "median"},
    ]
    # explicit, FINER grain than the derived coarsest ("subject")
    spec["test_grain"] = "subject/rep"

    fig, res, df_out, schema, model, issues = main._run(_table(df), spec)
    assert model["inferential_level"] == "rep"


def test_no_plan_keeps_derived_coarsest_level():
    """Sanity pin: without collapse/test_grain the inferential grain is the
    derived `coarsest_level`. With all layers left at RAW, that resolves to RAW
    (the spineless default) — proving the explicit-grain branch is what lifts the
    override test to "rep", not some incidental spine effect."""
    df = _paired_df()
    fig, res, df_out, schema, model, issues = main._run(_table(df), _base_spec())
    assert model["inferential_level"] == hierarchy.coarsest_level(
        ["subject", "rep"], [hierarchy.RAW])
    assert model["inferential_level"] == hierarchy.RAW
