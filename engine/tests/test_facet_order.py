"""Faceting honours the schema's declared categorical level order.

The x-axis already orders groups by `schema.levels`; faceting should match, so a
declared transition order (e.g. homo→homo first) is not silently alphabetised.
Columns with no declared levels keep the alphabetical fallback.
"""
import matplotlib
matplotlib.use("Agg")
import pandas as pd

from iris_engine import compiler


def _df():
    return pd.DataFrame({"tt": ["b", "a", "c", "a", "b", "c"],
                         "v": [1.0, 2, 3, 4, 5, 6]})


def test_facet_col_follows_declared_levels():
    schema = {"columns": [
        {"name": "tt", "type": "categorical", "levels": ["c", "a", "b"]},
        {"name": "v", "type": "numeric"}]}
    spec = {"facet": {"col": {"column": "tt"}}, "encodings": {}}
    _, col_col, _, col_levels = compiler._facet_levels(_df(), spec, schema)
    assert col_col == "tt"
    assert col_levels == ["c", "a", "b"]          # declared order, not sorted


def test_facet_undeclared_levels_stay_sorted():
    schema = {"columns": [{"name": "tt", "type": "categorical"},
                          {"name": "v", "type": "numeric"}]}
    spec = {"facet": {"col": {"column": "tt"}}, "encodings": {}}
    _, _, _, col_levels = compiler._facet_levels(_df(), spec, schema)
    assert col_levels == ["a", "b", "c"]          # fallback unchanged


def test_facet_levels_restricted_to_present():
    schema = {"columns": [
        {"name": "tt", "type": "categorical", "levels": ["c", "a", "b", "z"]},
        {"name": "v", "type": "numeric"}]}
    spec = {"facet": {"col": {"column": "tt"}}, "encodings": {}}
    _, _, _, col_levels = compiler._facet_levels(_df(), spec, schema)
    assert col_levels == ["c", "a", "b"]          # "z" absent from data → dropped


def test_facet_levels_schema_optional():
    # the historical 2-arg call still works (alphabetical), so existing callers
    # that do not pass schema are unaffected.
    spec = {"facet": {"col": {"column": "tt"}}, "encodings": {}}
    _, _, _, col_levels = compiler._facet_levels(_df(), spec)
    assert col_levels == ["a", "b", "c"]
