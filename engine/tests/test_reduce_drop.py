"""Drop step: name columns to REMOVE (remove-list); everything else passes through."""
import pandas as pd
import pytest

from iris_engine import reduce as reduce_mod

_SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "a", "type": "numeric"},
    {"name": "b", "type": "numeric"},
    {"name": "c", "type": "numeric"}]}


def _df():
    return pd.DataFrame({"id": ["r1", "r2"], "a": [1, 2], "b": [3, 4], "c": [5, 6]})


def test_drop_removes_listed_columns():
    out, sch = reduce_mod.apply_reduction(_df(), _SCHEMA, [{"kind": "drop", "columns": ["b"]}])
    assert [c["name"] for c in sch["columns"]] == ["a", "c"]
    assert list(out.columns) == ["id", "a", "c"]  # meta `id` preserved, `b` gone


def test_drop_empty_list_is_identity():
    out, sch = reduce_mod.apply_reduction(_df(), _SCHEMA, [{"kind": "drop", "columns": []}])
    assert [c["name"] for c in sch["columns"]] == ["a", "b", "c"]


def test_drop_unknown_column_raises():
    with pytest.raises(reduce_mod.ReduceError):
        reduce_mod.apply_reduction(_df(), _SCHEMA, [{"kind": "drop", "columns": ["zzz"]}])
