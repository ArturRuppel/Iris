"""Expression-valued filter bound — §5 landscape tail-clip at the 99th pct of |L|.

A condition may carry `bound: "<expr>"` instead of a static `value`. The bound is
evaluated over the CURRENT frame to a scalar, then `series <op> scalar` is applied.
The realized numeric bound is surfaced on the per-step trace record so provenance
can log it.
"""
import numpy as np
import pandas as pd
import pytest

from iris_engine import reduce as rd

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "g", "type": "categorical", "label": "G", "levels": ["a", "b"]},
        {"name": "value", "type": "numeric", "label": "Value"},
    ],
}


def frame():
    # many small values so the 99th pct of |value| sits well below the lone
    # outlier at index r100 (value 1000); that outlier must be clipped.
    vals = [float(((i % 7) - 3)) for i in range(100)]  # |value| in 0..3
    vals.append(1000.0)
    return pd.DataFrame(
        [{"id": f"r{i}", "g": "a", "value": v} for i, v in enumerate(vals)]
    )


def _cond_bound():
    return {"column": "value", "op": "<=",
            "bound": "quantile(abs(value), 0.99)"}


def test_quantile_bound_clips_the_tail():
    df = frame()
    expected_bound = float(np.percentile(np.abs(df["value"].to_numpy()), 99))
    keep = df[np.abs(df["value"]) <= expected_bound]["id"].tolist()

    out, _ = rd.apply_reduction(
        df, SCHEMA, [{"kind": "filter", "conditions": [_cond_bound()]}])
    assert out["id"].tolist() == keep
    # the lone 1000 outlier must be the one dropped
    assert "r100" not in out["id"].tolist()
    assert expected_bound < 1000.0


def test_realized_bound_is_surfaced_on_trace():
    df = frame()
    expected_bound = float(np.percentile(np.abs(df["value"].to_numpy()), 99))

    _, _, trace = rd.reduce_with_trace(
        df, SCHEMA, [{"kind": "filter", "conditions": [_cond_bound()]}])
    realized = trace[0]["realized_bounds"]
    assert len(realized) == 1
    assert realized[0] == pytest.approx(expected_bound)


def test_unsupported_bound_expr_raises():
    df = frame()
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(df, SCHEMA, [{"kind": "filter", "conditions": [
            {"column": "value", "op": "<=", "bound": "median(value)"}]}])


def test_quantile_bound_ignores_nans():
    # a routine NaN in the measurement column must not collapse the filter to
    # zero rows: np.percentile propagates NaN, np.nanpercentile does not.
    df = frame()
    df.loc[df["id"] == "r50", "value"] = np.nan
    expected_bound = float(np.nanpercentile(np.abs(df["value"].to_numpy()), 99))
    keep = df[np.abs(df["value"]) <= expected_bound]["id"].tolist()

    out, _ = rd.apply_reduction(
        df, SCHEMA, [{"kind": "filter", "conditions": [_cond_bound()]}])
    assert out["id"].tolist() == keep
    assert len(out) > 0  # the pre-fix bug kept 0 rows
    assert "r100" not in out["id"].tolist()  # the outlier is still clipped


def test_quantile_bound_all_missing_raises():
    df = frame()
    df["value"] = np.nan
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(
            df, SCHEMA, [{"kind": "filter", "conditions": [_cond_bound()]}])


def test_static_value_condition_unchanged():
    df = frame()
    out, _ = rd.apply_reduction(df, SCHEMA, [{"kind": "filter", "conditions": [
        {"column": "value", "op": ">", "value": 0}]}])
    expected = df[df["value"] > 0]["id"].tolist()
    assert out["id"].tolist() == expected
    assert "r100" in out["id"].tolist()  # the 1000 outlier survives a static >0
