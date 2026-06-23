"""recode: relabel a categorical column's values, pass through the unmapped."""
import pandas as pd
import pytest

from iris_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "class_label", "type": "categorical", "label": "Class",
         "levels": ["negative", "positive", "other"]},
        {"name": "value", "type": "numeric", "label": "Value"},
    ],
}


def frame():
    return pd.DataFrame([
        {"id": "r1", "class_label": "negative", "value": 1.0},
        {"id": "r2", "class_label": "positive", "value": 2.0},
        {"id": "r3", "class_label": "other", "value": 3.0},
    ])


def recode(column, mapping):
    return {"kind": "recode", "column": column, "map": mapping}


def test_recode_relabels_values_and_passes_unmapped_through():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        recode("class_label", {"negative": "VimentinKO", "positive": "NLS-mCherry"})])
    assert out["class_label"].tolist() == ["VimentinKO", "NLS-mCherry", "other"]


def test_recode_rewrites_schema_levels_dedup_order_preserving():
    _, schema = rd.apply_reduction(frame(), SCHEMA, [
        recode("class_label", {"negative": "VimentinKO", "positive": "NLS-mCherry"})])
    col = next(c for c in schema["columns"] if c["name"] == "class_label")
    assert col["levels"] == ["VimentinKO", "NLS-mCherry", "other"]


def test_recode_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [recode("nope", {"a": "b"})])


def test_recode_empty_map_is_noop():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [recode("class_label", {})])
    assert out["class_label"].tolist() == ["negative", "positive", "other"]
    col = next(c for c in schema["columns"] if c["name"] == "class_label")
    assert col["levels"] == ["negative", "positive", "other"]


def test_recode_non_categorical_relabels_values_but_leaves_schema_untouched():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [recode("value", {1.0: 99.0})])
    assert out["value"].tolist() == [99.0, 2.0, 3.0]
    col = next(c for c in schema["columns"] if c["name"] == "value")
    assert col == {"name": "value", "type": "numeric", "label": "Value"}  # no levels added
