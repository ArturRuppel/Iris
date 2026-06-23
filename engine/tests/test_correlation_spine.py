"""Spine-aware correlation — the replicate is the unit of inference.

Without a hierarchy spine, `stats.correlation` pools every row (the historical
behaviour). With a spine, the coarsest spine level is the inferential unit: a
per-unit coefficient is computed, and the association is tested across units
(one-sample t on Fisher-z of the per-unit r vs 0). Ground truth is recomputed
independently with scipy so the assertions can't be tautological. This is the
correlation analogue of how group_comparison/location/rate already collapse to
the inferential unit, and it reproduces the lab's replicate-level `_rep_r`.
"""
import json

import matplotlib
matplotlib.use("Agg")
import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from iris_engine import main, stats


def _nested_df(seed=1):
    """3 experiments, each a noisy NEGATIVE within-experiment association, offset
    so the pooled cloud is not the same as the per-experiment signal."""
    rng = np.random.default_rng(seed)
    rows = []
    for ei, off in enumerate([0.0, 8.0, 16.0]):
        x = rng.uniform(0, 5, 40)
        y = off - 0.7 * x + rng.normal(0, 0.5, 40)   # consistent negative slope
        for xi, yi in zip(x, y):
            rows.append({"experiment_id": f"E{ei}", "x": xi, "y": yi})
    return pd.DataFrame(rows)


def _expected_rep(df, method="spearman"):
    """Independent recompute of the replicate-level statistic."""
    rs = []
    for _, g in df.groupby("experiment_id"):
        r = (sps.spearmanr(g.x, g.y).statistic if method == "spearman"
             else sps.pearsonr(g.x, g.y).statistic)
        rs.append(r)
    rs = np.array(rs)
    z = np.arctanh(np.clip(rs, -0.999, 0.999))
    p = float(sps.ttest_1samp(z, 0).pvalue)
    return float(rs.mean()), p, len(rs)


def test_spine_correlation_matches_per_unit_aggregate():
    df = _nested_df()
    res = stats.correlation(df, "x", "y", unit_cols=["experiment_id"],
                            override="spearman")
    r_exp, p_exp, n_exp = _expected_rep(df, "spearman")
    assert res["result"]["n"] == n_exp == 3              # the replicate is the unit
    assert res["result"]["r"] == pytest.approx(r_exp, rel=1e-6)
    assert res["result"]["p"] == pytest.approx(p_exp, rel=1e-6)
    assert res["result"]["r"] < 0                        # the real within-unit sign


def test_spine_differs_from_pooled():
    df = _nested_df()
    pooled = stats.correlation(df, "x", "y", override="spearman")["result"]
    spined = stats.correlation(df, "x", "y", unit_cols=["experiment_id"],
                               override="spearman")["result"]
    # pooled n is every row; spined n is the replicate count
    assert pooled["n"] == len(df) and spined["n"] == 3
    # the offsets wash out the pooled signal, so the two disagree materially
    assert abs(pooled["r"] - spined["r"]) > 0.2


def test_spineless_correlation_unchanged():
    df = _nested_df()
    a = stats.correlation(df, "x", "y", override="spearman")
    b = stats.correlation(df, "x", "y", unit_cols=None, override="spearman")
    assert a["result"] == b["result"]                    # default path untouched


def test_spine_plumbed_through_render():
    df = _nested_df()
    df.insert(0, "id", [f"r{i}" for i in range(len(df))])
    schema = {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier"},
        {"name": "experiment_id", "type": "identifier", "label": "experiment"},
        {"name": "x", "type": "numeric", "label": "X"},
        {"name": "y", "type": "numeric", "label": "Y"}]}
    spec = {"spec_version": "2.0", "title": "t",
            "encodings": {"x": {"column": "x"}, "y": {"column": "y"},
                          "color": None, "size": None, "shape": None},
            "hierarchy": {"spine": ["experiment_id"], "fn": {}},
            "layers": [{"geom": "scatter", "params": {}},
                       {"geom": "regression", "params": {}}],
            "stats": {"family": "correlation", "alpha": 0.05}, "_override": "spearman"}
    recs = json.loads(df.to_json(orient="records"))
    _, res, *_ = main._run({"schema": schema, "rows": recs}, spec)
    r_exp, p_exp, n_exp = _expected_rep(df, "spearman")
    assert res["result"]["n"] == n_exp
    assert res["result"]["r"] == pytest.approx(r_exp, rel=1e-6)
    assert res["result"]["p"] == pytest.approx(p_exp, rel=1e-6)
