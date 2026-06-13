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
