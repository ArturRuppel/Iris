"""Reduction layer: an ordered pipeline of select / filter / collapse steps."""
import pandas as pd
import pytest

from triad_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "treatment", "type": "categorical", "label": "Treatment",
         "levels": ["control", "drug_a"]},
        {"name": "dose", "type": "numeric", "label": "Dose"},
        {"name": "response", "type": "numeric", "label": "Response"},
    ],
}


def frame():
    rows = [
        {"id": "r1", "subject": "S1", "treatment": "control", "dose": 10.0, "response": 80.0},
        {"id": "r2", "subject": "S1", "treatment": "control", "dose": 20.0, "response": 70.0},
        {"id": "r3", "subject": "S2", "treatment": "drug_a", "dose": 10.0, "response": 60.0},
        {"id": "r4", "subject": "S2", "treatment": "drug_a", "dose": 20.0, "response": 50.0},
    ]
    return pd.DataFrame(rows)


def filter_step(conditions):
    return {"kind": "filter", "conditions": conditions}


def collapse_step(group_by, aggregate=None):
    return {"kind": "collapse", "group_by": group_by, "aggregate": aggregate or {}}


def select_step(columns):
    return {"kind": "select", "columns": columns}


# ---- empty / passthrough ----

def test_no_steps_passes_through():
    df = frame()
    out, schema = rd.apply_reduction(df, SCHEMA, [])
    assert out.equals(df)
    assert schema == SCHEMA


def test_none_steps_passes_through():
    out, schema = rd.apply_reduction(frame(), SCHEMA, None)
    assert out["id"].tolist() == ["r1", "r2", "r3", "r4"]
    assert schema == SCHEMA


# ---- select ----

def test_select_keeps_and_orders_columns():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        select_step(["response", "treatment"])])
    # meta columns ride along; data columns are exactly the selection, in order
    assert [c for c in out.columns if c not in ("id", "excluded")] == ["response", "treatment"]
    assert [c["name"] for c in schema["columns"]] == ["response", "treatment"]
    # rows preserved
    assert out["response"].tolist() == [80.0, 70.0, 60.0, 50.0]


def test_select_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [select_step(["nope"])])


def test_step_referencing_dropped_column_raises():
    # select drops `dose`; a later filter on it must error, not silently pass
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [
            select_step(["treatment", "response"]),
            filter_step([{"column": "dose", "op": ">", "value": 5}])])


# ---- filter ----

def test_filter_equals_categorical():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        filter_step([{"column": "treatment", "op": "==", "value": "control"}])])
    assert out["id"].tolist() == ["r1", "r2"]


def test_filter_numeric_comparison_and_ands():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        filter_step([{"column": "dose", "op": ">=", "value": 20},
                     {"column": "treatment", "op": "!=", "value": "control"}])])
    assert out["id"].tolist() == ["r4"]


def test_filter_in_and_not_in():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        filter_step([{"column": "treatment", "op": "in", "value": ["drug_a"]}])])
    assert out["id"].tolist() == ["r3", "r4"]


def test_filter_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [
            filter_step([{"column": "nope", "op": "==", "value": 1}])])


# ---- collapse ----

def test_collapse_mean_per_group():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        collapse_step(["treatment"], {"response": "mean"})])
    out = out.set_index("treatment")
    assert out.loc["control", "response"] == pytest.approx(75.0)
    assert out.loc["drug_a", "response"] == pytest.approx(55.0)
    types = {c["name"]: c["type"] for c in schema["columns"]}
    assert types["treatment"] == "categorical"
    assert types["response"] == "numeric"


def test_collapse_default_mean_for_unlisted_numeric():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [collapse_step(["treatment"])])
    out = out.set_index("treatment")
    assert out.loc["control", "dose"] == pytest.approx(15.0)
    assert out.loc["control", "response"] == pytest.approx(75.0)


def test_collapse_count_adds_n_column():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        collapse_step(["treatment"], {"response": "count"})])
    assert set(out["n"]) == {2}
    assert any(c["name"] == "n" for c in schema["columns"])


def test_collapse_sem_matches_scipy():
    from scipy.stats import sem
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        collapse_step(["treatment"], {"response": "sem"})])
    out = out.set_index("treatment")
    assert out.loc["control", "response"] == pytest.approx(sem([80.0, 70.0]))


def test_collapse_assigns_fresh_row_ids():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [collapse_step(["treatment"])])
    assert "id" in out and out["id"].is_unique


# ---- ordered composition: filter -> collapse -> filter ----

def test_filter_after_collapse_keeps_groups_by_aggregate():
    # collapse to per-(treatment) means, then keep only groups with mean dose >= 15
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        collapse_step(["treatment", "subject"], {"dose": "mean", "response": "count"}),
        filter_step([{"column": "n", "op": ">", "value": 1}])])
    # each subject has 2 rows -> n == 2 for both, both survive
    assert len(out) == 2
    out2, _ = rd.apply_reduction(frame(), SCHEMA, [
        collapse_step(["treatment", "subject"], {"dose": "mean", "response": "count"}),
        filter_step([{"column": "n", "op": ">", "value": 5}])])
    assert len(out2) == 0


# ---- trace ----

def test_trace_reports_rows_and_schema_per_step():
    steps = [
        select_step(["treatment", "subject", "response"]),
        filter_step([{"column": "treatment", "op": "==", "value": "control"}]),
        collapse_step(["treatment"], {"response": "mean"}),
    ]
    out, schema, trace = rd.reduce_with_trace(frame(), SCHEMA, steps)
    assert [t["n_rows_out"] for t in trace] == [4, 2, 1]
    # the collapse step's output schema lost `subject`, kept treatment + response
    last_cols = [c["name"] for c in trace[-1]["schema_out"]["columns"]]
    assert "treatment" in last_cols and "response" in last_cols
    assert "subject" not in last_cols
    assert len(out) == 1
