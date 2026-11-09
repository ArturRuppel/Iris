"""derive: a row-wise scalar expression over existing columns, grain-safe."""
import numpy as np
import pandas as pd
import pytest

from iris_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "perimeter", "type": "numeric", "label": "Perimeter"},
        {"name": "area", "type": "numeric", "label": "Area"},
    ],
}


def frame():
    return pd.DataFrame([
        {"id": "r1", "perimeter": 12.0, "area": 9.0},
        {"id": "r2", "perimeter": 20.0, "area": 16.0},
    ])


def derive(column, expr):
    return {"kind": "derive", "column": column, "expr": expr}


def test_derive_log_matches_numpy():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        derive("area", "log(area)")])           # overwrite in place
    assert out["area"].tolist() == pytest.approx(np.log([9.0, 16.0]).tolist())
    # overwriting an existing numeric column leaves the schema unchanged
    assert [c["name"] for c in schema["columns"]] == ["perimeter", "area"]


def test_derive_ratio_adds_numeric_column():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        derive("q", "perimeter / sqrt(area)")])
    assert out["q"].tolist() == pytest.approx(
        (np.array([12.0, 20.0]) / np.sqrt([9.0, 16.0])).tolist())
    q = next(c for c in schema["columns"] if c["name"] == "q")
    assert q == {"name": "q", "type": "numeric", "label": "q"}


def test_derive_unknown_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [derive("q", "nope * 2")])


def test_derive_unsupported_function_raises():
    # string ops / arbitrary calls are deferred (Tier C); reject loudly
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [derive("q", "min(area, 1)")])


def test_derive_unary_minus_and_int_constant():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        derive("q", "-perimeter + area * 2")])
    assert out["q"].tolist() == pytest.approx(
        (-np.array([12.0, 20.0]) + np.array([9.0, 16.0]) * 2).tolist())


def test_derive_rejects_bool_constant():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [derive("q", "area * True")])


def test_derive_backticked_name_or_label_references_a_column():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        derive("q", "`perimeter` / sqrt(`Area`)")])   # name in backticks, label in backticks
    assert out["q"].tolist() == pytest.approx(
        (np.array([12.0, 20.0]) / np.sqrt([9.0, 16.0])).tolist())


def test_derive_backticks_reach_a_column_whose_name_is_not_an_identifier():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        derive("speed (µm/h)", "perimeter / 0.25"),
        derive("twice", "`speed (µm/h)` * 2")])
    assert out["twice"].tolist() == pytest.approx([96.0, 160.0])
    assert [c["name"] for c in schema["columns"]][-2:] == ["speed (µm/h)", "twice"]


def test_derive_unknown_backticked_reference_fails_loudly():
    with pytest.raises(rd.ReduceError, match="unknown column 'nope'"):
        rd.apply_reduction(frame(), SCHEMA, [derive("q", "`nope` / 2")])


def test_filter_bound_accepts_backticked_label():
    out, _ = rd.apply_reduction(frame(), SCHEMA, [
        {"kind": "filter", "conditions": [
            {"column": "area", "op": ">=", "bound": "quantile(`Area`, 0.5)"}]}])
    assert out["area"].tolist() == [16.0]
