"""derive: comparison -> 0/1, string concat, str() cast."""
import pandas as pd, pytest
from iris_engine import reduce as rd

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "a", "type": "categorical", "label": "A", "levels": ["x", "y"]},
    {"name": "b", "type": "categorical", "label": "B", "levels": ["x", "y"]},
    {"name": "e", "type": "identifier", "label": "E"},
    {"name": "n", "type": "numeric", "label": "N"}]}

def frame():
    return pd.DataFrame([
        {"id": "r1", "a": "x", "b": "y", "e": "E1", "n": 3},
        {"id": "r2", "a": "x", "b": "x", "e": "E1", "n": 7}])

def d(col, expr): return {"kind": "derive", "column": col, "expr": expr}

def test_comparison_yields_int_flag():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [d("opp", "a != b")])
    assert out["opp"].tolist() == [1, 0]

def test_string_concat_builds_key():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [d("ev", 'e + "|" + str(n)')])
    assert out["ev"].tolist() == ["E1|3", "E1|7"]

def test_equality_yields_int_flag():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [d("same", "a == b")])
    assert out["same"].tolist() == [0, 1]

def test_numeric_add_still_works():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [d("q", "n + 1")])
    assert out["q"].tolist() == [4, 8]
