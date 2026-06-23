"""Null-predicate filter ops — the notebook's .dropna(subset=[value])."""
import numpy as np
import pandas as pd

from iris_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "g", "type": "categorical", "label": "G", "levels": ["a", "b"]},
        {"name": "value", "type": "numeric", "label": "Value"},
    ],
}


def frame():
    return pd.DataFrame([
        {"id": "r1", "g": "a", "value": 1.0},
        {"id": "r2", "g": "a", "value": np.nan},
        {"id": "r3", "g": "b", "value": 3.0},
    ])


def test_not_null_drops_missing_rows():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        {"kind": "filter", "conditions": [{"column": "value", "op": "not-null"}]}])
    assert out["id"].tolist() == ["r1", "r3"]


def test_is_null_keeps_only_missing_rows():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        {"kind": "filter", "conditions": [{"column": "value", "op": "is-null"}]}])
    assert out["id"].tolist() == ["r2"]


def test_not_null_combined_with_categorical():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [{"kind": "filter", "conditions": [
        {"column": "g",     "op": "in",       "value": ["a"]},
        {"column": "value", "op": "not-null"},
    ]}])
    assert out["id"].tolist() == ["r1"]   # r2 dropped (null value), r3 dropped (g=b)
