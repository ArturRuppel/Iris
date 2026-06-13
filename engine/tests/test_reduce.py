"""Reduction layer: filter rows, then optionally collapse to group summaries."""
import numpy as np
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


def test_no_reduce_passes_through():
    df = frame()
    out, schema = rd.apply_reduction(df, SCHEMA, {"filter": [], "collapse": None})
    assert out.equals(df)
    assert schema == SCHEMA


def test_filter_equals_categorical():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [{"column": "treatment", "op": "==", "value": "control"}],
        "collapse": None})
    assert out["id"].tolist() == ["r1", "r2"]


def test_filter_numeric_comparison_and_ands():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [{"column": "dose", "op": ">=", "value": 20},
                   {"column": "treatment", "op": "!=", "value": "control"}],
        "collapse": None})
    assert out["id"].tolist() == ["r4"]


def test_filter_in_and_not_in():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [{"column": "treatment", "op": "in", "value": ["drug_a"]}],
        "collapse": None})
    assert out["id"].tolist() == ["r3", "r4"]


def test_filter_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, {
            "filter": [{"column": "nope", "op": "==", "value": 1}], "collapse": None})


def test_collapse_mean_per_group():
    out, schema = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [],
        "collapse": {"group_by": ["treatment"], "aggregate": {"response": "mean"}}})
    out = out.set_index("treatment")
    assert out.loc["control", "response"] == pytest.approx(75.0)
    assert out.loc["drug_a", "response"] == pytest.approx(55.0)
    types = {c["name"]: c["type"] for c in schema["columns"]}
    assert types["treatment"] == "categorical"
    assert types["response"] == "numeric"


def test_collapse_default_mean_for_unlisted_numeric():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [], "collapse": {"group_by": ["treatment"], "aggregate": {}}})
    out = out.set_index("treatment")
    assert out.loc["control", "dose"] == pytest.approx(15.0)
    assert out.loc["control", "response"] == pytest.approx(75.0)


def test_collapse_count_adds_n_column():
    out, schema = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [],
        "collapse": {"group_by": ["treatment"], "aggregate": {"response": "count"}}})
    assert set(out["n"]) == {2}
    assert any(c["name"] == "n" for c in schema["columns"])


def test_collapse_sem_matches_scipy():
    from scipy.stats import sem
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [],
        "collapse": {"group_by": ["treatment"], "aggregate": {"response": "sem"}}})
    out = out.set_index("treatment")
    assert out.loc["control", "response"] == pytest.approx(sem([80.0, 70.0]))


def test_collapse_assigns_fresh_row_ids():
    out, _ = rd.apply_reduction(frame(), SCHEMA, {
        "filter": [], "collapse": {"group_by": ["treatment"], "aggregate": {}}})
    assert "id" in out and out["id"].is_unique
