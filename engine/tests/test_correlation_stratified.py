"""Group-stratified correlation — the X–Y association computed PER group.

When a categorical color (grouping) is present on a correlation, Iris runs one
coefficient per group rather than pooling them, returning a `per_group` list (the
same contract location/rate use) plus a per-group regression for the figure. This
is the general "does the relationship differ by treatment/genotype/condition?"
question. It composes with the spine: each per-group coefficient is itself
replicate-level when a spine is declared. Ground truth is recomputed with scipy.
"""
import json

import matplotlib
matplotlib.use("Agg")
import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from iris_engine import compiler, main, stats


def _two_group_df(seed=2):
    """Group A: positive association; group B: negative. Pooled is muddled, so a
    single pooled r would misrepresent both."""
    rng = np.random.default_rng(seed)
    xa = rng.uniform(0, 5, 60); ya = 0.8 * xa + rng.normal(0, 0.4, 60)
    xb = rng.uniform(0, 5, 60); yb = -0.8 * xb + 6 + rng.normal(0, 0.4, 60)
    return pd.DataFrame({
        "grp": ["A"] * 60 + ["B"] * 60,
        "x": np.r_[xa, xb], "y": np.r_[ya, yb]})


def test_stratified_matches_scipy_per_group():
    df = _two_group_df()
    res = stats.correlation(df, "x", "y", group_col="grp", override="pearson")
    by = {g["level"]: g for g in res["per_group"]}
    assert set(by) == {"A", "B"}
    for lv in ("A", "B"):
        s = df[df.grp == lv]
        r_exp = sps.pearsonr(s.x, s.y)
        assert by[lv]["r"] == pytest.approx(r_exp.statistic, rel=1e-6)
        assert by[lv]["p"] == pytest.approx(r_exp.pvalue, rel=1e-6)
        assert by[lv]["n"] == len(s)
        assert "regression" in by[lv]            # each group draws its own line
    assert by["A"]["r"] > 0.5 and by["B"]["r"] < -0.5   # opposite, not cancelled


def test_no_group_col_has_no_per_group():
    df = _two_group_df()
    res = stats.correlation(df, "x", "y", override="pearson")
    assert "per_group" not in res or not res.get("per_group")
    assert res["result"]["n"] == len(df)         # pooled, unchanged


def test_stratified_composes_with_spine():
    # each group nested over 3 experiments; the per-group coefficient is the
    # replicate-level one (n = 3 experiments), not the pooled cell count.
    rng = np.random.default_rng(5)
    rows = []
    for grp, slope in [("A", 0.7), ("B", -0.7)]:
        for ei, off in enumerate([0.0, 5.0, 10.0]):
            x = rng.uniform(0, 5, 30)
            y = off + slope * x + rng.normal(0, 0.4, 30)
            for xi, yi in zip(x, y):
                rows.append({"grp": grp, "experiment_id": f"E{ei}", "x": xi, "y": yi})
    df = pd.DataFrame(rows)
    res = stats.correlation(df, "x", "y", group_col="grp",
                            unit_cols=["experiment_id"], override="spearman")
    by = {g["level"]: g for g in res["per_group"]}
    for lv, sign in [("A", 1), ("B", -1)]:
        s = df[df.grp == lv]
        rs = [sps.spearmanr(g.x, g.y).statistic for _, g in s.groupby("experiment_id")]
        z = np.arctanh(np.clip(rs, -0.999, 0.999))
        assert by[lv]["n"] == 3                   # replicate is the unit
        # the point estimate is back-transformed from Fisher-z, same scale as the CI
        assert by[lv]["r"] == pytest.approx(float(np.tanh(np.mean(z))), rel=1e-6)
        assert by[lv]["p"] == pytest.approx(float(sps.ttest_1samp(z, 0).pvalue), rel=1e-6)
        assert np.sign(by[lv]["r"]) == sign


def test_render_auto_stratifies_on_categorical_color():
    df = _two_group_df()
    df.insert(0, "id", [f"r{i}" for i in range(len(df))])
    schema = {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier"},
        {"name": "grp", "type": "categorical", "label": "Group", "levels": ["A", "B"]},
        {"name": "x", "type": "numeric", "label": "X"},
        {"name": "y", "type": "numeric", "label": "Y"}]}
    spec = {"spec_version": "2.0", "title": "t",
            "encodings": {"x": {"column": "x"}, "y": {"column": "y"},
                          "color": {"column": "grp"}, "size": None, "shape": None},
            "layers": [{"geom": "scatter", "params": {}},
                       {"geom": "regression", "params": {}}],
            "stats": {"family": "correlation", "alpha": 0.05}, "_override": "pearson"}
    recs = json.loads(df.to_json(orient="records"))
    fig, res, *_ = main._run({"schema": schema, "rows": recs}, spec)
    assert len(res["per_group"]) == 2            # color → per-group stats
    # one regression line per group drawn (plus the points)
    svg = compiler.figure_to_svg(fig)
    assert svg.count("ρ = ") + svg.count("r = ") >= 2   # an annotation per group
    compiler.close(fig)
