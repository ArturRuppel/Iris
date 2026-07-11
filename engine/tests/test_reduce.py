"""Reduction layer: an ordered pipeline of drop / filter steps. Aggregation is
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


def drop_step(columns):
    return {"kind": "drop", "columns": columns}


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


# ---- drop ----

def test_drop_removes_listed_columns():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        drop_step(["subject", "dose"])])
    # meta columns ride along; data columns are everything except the dropped ones
    assert [c for c in out.columns if c != "id"] == ["treatment", "response"]
    assert [c["name"] for c in schema["columns"]] == ["treatment", "response"]
    # rows preserved
    assert out["response"].tolist() == [80.0, 70.0, 60.0, 50.0]


def test_drop_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [drop_step(["nope"])])


def test_step_referencing_dropped_column_raises():
    # drop removes `subject` and `dose`; a later filter on `dose` must error, not silently pass
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [
            drop_step(["subject", "dose"]),
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
        drop_step(["dose"]),
        filter_step([{"column": "treatment", "op": "==", "value": "control"}]),
    ]
    out, schema, trace = rd.reduce_with_trace(frame(), SCHEMA, steps)
    assert [t["n_rows_out"] for t in trace] == [4, 2]
    # the drop step's output schema removed `dose`, kept treatment/subject/response
    last_cols = [c["name"] for c in trace[-1]["schema_out"]["columns"]]
    assert "treatment" in last_cols and "response" in last_cols
    assert "dose" not in last_cols
    assert len(out) == 2


def test_join_frames_merges_on_key():
    from iris_engine.reduce import _join_frames
    import pandas as pd
    left = pd.DataFrame({"cell": ["a", "b"], "speed": [1.0, 2.0]})
    left_schema = {"columns": [{"name": "cell", "type": "categorical"},
                               {"name": "speed", "type": "numeric"}]}
    right = pd.DataFrame({"cell": ["a", "b"], "het": [0.1, 0.2]})
    right_schema = {"columns": [{"name": "cell", "type": "categorical"},
                                {"name": "het", "type": "numeric"}]}
    out, schema = _join_frames(left, left_schema, right, right_schema, ["cell"], "inner")
    assert list(out.columns) >= ["cell", "speed", "het"]
    assert out.loc[out.cell == "a", "het"].iloc[0] == 0.1
    assert any(c["name"] == "het" for c in schema["columns"])
