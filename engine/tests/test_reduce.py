"""Reduction layer: an ordered pipeline of select / filter steps. Aggregation is
NOT a reduce step — it is the data hierarchy's job (see test_hierarchy.py)."""
import pandas as pd
import pytest

from iris_engine import reduce as rd

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


# ---- aggregation is NOT a reduce step ----

def test_collapse_step_is_rejected():
    # collapse was removed: aggregating to a grain is the data hierarchy's job, so
    # a stray collapse step must error loudly, never silently aggregate.
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [
            {"kind": "collapse", "group_by": ["treatment"], "aggregate": {}}])


# ---- trace ----

def test_trace_reports_rows_and_schema_per_step():
    steps = [
        select_step(["treatment", "subject", "response"]),
        filter_step([{"column": "treatment", "op": "==", "value": "control"}]),
    ]
    out, schema, trace = rd.reduce_with_trace(frame(), SCHEMA, steps)
    assert [t["n_rows_out"] for t in trace] == [4, 2]
    # the select step's output schema dropped `dose`, kept treatment/subject/response
    last_cols = [c["name"] for c in trace[-1]["schema_out"]["columns"]]
    assert "treatment" in last_cols and "response" in last_cols
    assert "dose" not in last_cols
    assert len(out) == 2
