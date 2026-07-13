"""Inference produces (value_type, identifier_role) as orthogonal facts: a key
column keeps its value type, so an integer index is a NUMERIC identifier that can
still be plotted on an axis."""
import pandas as pd

from iris_engine.importer import _infer_type


def _t(values, name):
    return _infer_type(pd.Series(values, name=name), ".")


def test_integer_key_is_a_numeric_identifier():
    # named like a key + integer-valued → numeric value type, identifier role
    assert _t([1, 2, 3, 1, 2, 3], "well_id") == ("numeric", True)
    assert _t([0, 1, 2, 3], "frame") == ("numeric", True)


def test_plain_numeric_measure_is_not_an_identifier():
    assert _t([1.2, 3.4, 5.6], "area") == ("numeric", False)
    # a float column named like time is still a measure (not integer-valued)
    assert _t([0.1, 0.2, 0.3], "time") == ("numeric", False)


def test_string_key_is_a_categorical_identifier():
    # named like a key
    assert _t(["a", "b", "a", "b"], "position") == ("categorical", True)
    # every value unique over a decent sample → a label key
    vt, ident = _t([f"cell_{i}" for i in range(20)], "label")
    assert (vt, ident) == ("categorical", True)


def test_low_cardinality_string_is_a_free_classifier():
    assert _t(["control", "drug", "control", "drug"], "treatment") == ("categorical", False)


def test_bool_is_neither():
    assert _t(["true", "false", "true"], "alive") == ("bool", False)
