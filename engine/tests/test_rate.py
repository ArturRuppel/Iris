"""Rate / count-regression family + the pointrange geom (item Q).

`stats.rate` fits a per-group count GLM (Poisson / negative binomial) with a
log-exposure offset, reports rate = exp(intercept) ± a model CI, and a global
likelihood-ratio test for "does group matter". Ground truth is recomputed
independently with statsmodels so an assertion can't be a tautology. Covers the
per-group estimate + CI, the Poisson/NB/auto model channel, the global LR test,
the spine path (counts summed to the inferential unit), the declared-family
plumbing, and the figure (one pointrange per lane, asymmetric CI, no brackets).
"""
import json

import matplotlib
matplotlib.use("Agg")
import numpy as np
import pandas as pd
import pytest
import statsmodels.api as sm
from scipy import stats as sps

from iris_engine import compiler, main, specnorm, statmodel, stats


# ── synthetic data ───────────────────────────────────────────────────────────

def _rate_df(rates, *, seed=4, n=12, disp=0.4):
    """One `count` per categorical `grp`, drawn negative-binomial around
    `rate * exposure` so the data is genuinely overdispersed (NB-appropriate)."""
    rng = np.random.default_rng(seed)
    rows = []
    for g, r in rates.items():
        for _ in range(n):
            hours = float(rng.uniform(3.0, 6.0))
            mu = r * hours
            p = 1.0 / (1.0 + disp * mu)
            k = int(rng.negative_binomial(1.0 / disp, p))
            rows.append({"grp": g, "count": k, "hours": hours})
    return pd.DataFrame(rows)


def _direct_fit(sub, model):
    """A bare statsmodels fit of count ~ 1 offset=log(hours) for one group."""
    y = sub["count"].to_numpy(float)
    off = np.log(sub["hours"].to_numpy(float))
    X = np.ones((len(y), 1))
    if model == "poisson":
        return sm.GLM(y, X, family=sm.families.Poisson(), offset=off).fit()
    return sm.NegativeBinomial(y, X, offset=off).fit(disp=0, maxiter=200)


# ── per-group estimate + CI match a direct statsmodels fit ───────────────────

@pytest.mark.parametrize("model", ["poisson", "nb"])
def test_rate_and_ci_match_statsmodels(model):
    df = _rate_df({"A": 1.5, "B": 4.0})
    res = stats.rate(df, "grp", "count", exposure="hours",
                     levels=["A", "B"], model=model)
    assert res["family"] == "rate" and res["model"] == model
    z = float(sps.norm.ppf(0.975))
    by = {g["level"]: g for g in res["per_group"]}
    for lv in ("A", "B"):
        fit = _direct_fit(df[df.grp == lv], model)
        b, se = float(fit.params[0]), float(fit.bse[0])
        assert by[lv]["rate"] == pytest.approx(np.exp(b), rel=1e-6)
        assert by[lv]["ci"][0] == pytest.approx(np.exp(b - z * se), rel=1e-6)
        assert by[lv]["ci"][1] == pytest.approx(np.exp(b + z * se), rel=1e-6)
        assert by[lv]["ci"][1] > by[lv]["rate"] > by[lv]["ci"][0]   # bracketed


def test_global_lr_test_matches_recompute():
    df = _rate_df({"A": 1.5, "B": 4.0, "C": 1.8})
    res = stats.rate(df, "grp", "count", exposure="hours",
                     levels=["A", "B", "C"], model="poisson")
    y = df["count"].to_numpy(float)
    off = np.log(df["hours"].to_numpy(float))
    null = sm.GLM(y, np.ones((len(y), 1)),
                  family=sm.families.Poisson(), offset=off).fit()
    dummies = pd.get_dummies(df["grp"], drop_first=True).to_numpy(float)
    full = sm.GLM(y, np.column_stack([np.ones(len(y)), dummies]),
                  family=sm.families.Poisson(), offset=off).fit()
    lr = 2 * (full.llf - null.llf)
    p = float(sps.chi2.sf(lr, 2))
    assert res["result"]["p"] == pytest.approx(p, rel=1e-6)
    assert res["decision"]["global"]["df"] == 2


# ── model channel: nb default, poisson pin, auto switch ──────────────────────

def test_auto_picks_nb_on_overdispersed_poisson_on_clean():
    over = _rate_df({"A": 1.5, "B": 4.0}, disp=0.8)         # strongly overdispersed
    assert stats.rate(over, "grp", "count", exposure="hours",
                      levels=["A", "B"], model="auto")["model"] == "nb"

    # exactly-Poisson counts (no extra dispersion) → auto stays Poisson
    rng = np.random.default_rng(0)
    rows = []
    for g, r in {"A": 2.0, "B": 5.0}.items():
        for _ in range(40):
            h = float(rng.uniform(3, 6))
            rows.append({"grp": g, "count": int(rng.poisson(r * h)), "hours": h})
    clean = pd.DataFrame(rows)
    assert stats.rate(clean, "grp", "count", exposure="hours",
                      levels=["A", "B"], model="auto")["model"] == "poisson"


def test_no_exposure_uses_unit_offset():
    # rate with exposure = 1 reduces to the mean count per group
    df = pd.DataFrame({"grp": ["A"] * 20, "count": [3, 5, 4, 6, 2] * 4})
    res = stats.rate(df, "grp", "count", levels=["A"], model="poisson")
    assert res["per_group"][0]["rate"] == pytest.approx(np.mean([3, 5, 4, 6, 2]),
                                                        rel=1e-6)
    assert res["exposure"] is None


# ── spine path: counts summed to the inferential unit ────────────────────────

def _spine_schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "grp", "type": "categorical", "label": "Group"},
        {"name": "field", "type": "identifier", "label": "Field"},
        {"name": "well", "type": "identifier", "label": "Well"},
        {"name": "count", "type": "numeric", "label": "Events"},
        {"name": "hours", "type": "numeric", "label": "Hours"}]}


def test_spine_sums_counts_to_the_unit():
    rows, rid = [], 0
    # 2 groups × 3 fields × 4 wells; the unit is the field (counts/hours summed)
    for g in ("A", "B"):
        for f in ("f1", "f2", "f3"):
            for w in range(4):
                rows.append({"id": f"r{rid}", "grp": g, "field": f"{g}-{f}",
                             "well": f"{g}-{f}-{w}", "count": 2, "hours": 1.0})
                rid += 1
    df = pd.DataFrame(rows)
    spec = {"spec_version": "2.0", "title": "t",
            "encodings": {"x": {"column": "grp"}, "y": {"column": "count"},
                          "color": None, "size": None, "shape": None},
            "hierarchy": {"spine": ["field", "well"], "fn": {}},
            "layers": [{"geom": "pointrange", "params": {}, "level": "field"}],
            "stats": {"family": "rate", "exposure": "hours", "model": "poisson",
                      "alpha": 0.05}}
    recs = json.loads(df.to_json(orient="records"))
    _, res, *_ = main._run({"schema": _spine_schema(), "rows": recs}, spec)
    by = {g["level"]: g for g in res["per_group"]}
    # 3 fields per group → n counts fields, each field summed to 8 events / 4 hours
    assert by["A"]["n"] == 3 and by["B"]["n"] == 3
    assert by["A"]["count"] == pytest.approx(3 * 8)      # summed, not averaged
    assert by["A"]["exposure"] == pytest.approx(3 * 4)
    assert by["A"]["rate"] == pytest.approx(2.0, rel=1e-6)   # 8 events / 4 hours


# ── statmodel / specnorm: opt-in family, no regression of the default ────────

def _schema_cat_num():
    return {"schema_version": "1.0", "columns": [
        {"name": "grp", "type": "categorical"},
        {"name": "count", "type": "numeric"}]}


def test_statmodel_honours_declared_rate_family():
    enc = {"x": {"column": "grp"}, "y": {"column": "count"},
           "color": None, "size": None, "shape": None}
    model = statmodel.infer(enc, _schema_cat_num(), None,
                            declared_family="rate", exposure="hours", model="nb")
    assert model["family"] == "rate"
    assert model["exposure"] == "hours" and model["model"] == "nb"
    assert model["chosen_by"] == "inferred"


def test_plain_cat_numeric_still_infers_group_comparison():
    enc = {"x": {"column": "grp"}, "y": {"column": "count"},
           "color": None, "size": None, "shape": None}
    assert statmodel.infer(enc, _schema_cat_num(), None)["family"] == "group_comparison"


def test_specnorm_preserves_rate_family_and_defaults_model():
    spec = {"spec_version": "2.0", "encodings": {}, "layers": [],
            "stats": {"family": "rate", "exposure": "hours"}}
    out = specnorm.normalize(spec)
    assert out["stats"]["family"] == "rate"
    assert out["stats"]["model"] == "nb"
    assert out["stats"]["exposure"] == "hours"


# ── figure: one pointrange per lane, asymmetric CI, no brackets ──────────────

def _render_rate(*, horizontal=False):
    df = _rate_df({"A": 1.5, "B": 4.0, "C": 1.8})
    df.insert(0, "id", [f"r{i}" for i in range(len(df))])
    schema = {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier"},
        {"name": "grp", "type": "categorical", "label": "Group",
         "levels": ["A", "B", "C"]},
        {"name": "count", "type": "numeric", "label": "Events"},
        {"name": "hours", "type": "numeric", "label": "Hours"}]}
    if horizontal:
        enc = {"x": {"column": "count"}, "y": {"column": "grp"},
               "color": None, "size": None, "shape": None}
    else:
        enc = {"x": {"column": "grp"}, "y": {"column": "count"},
               "color": None, "size": None, "shape": None}
    spec = {"spec_version": "2.0", "title": "t", "encodings": enc,
            "layers": [{"geom": "pointrange", "params": {}}],
            "stats": {"family": "rate", "exposure": "hours", "model": "nb",
                      "alpha": 0.05}}
    recs = json.loads(df.to_json(orient="records"))
    fig, res, *_ = main._run({"schema": schema, "rows": recs}, spec)
    return fig, res


def test_pointrange_draws_one_estimate_per_lane():
    fig, res = _render_rate()
    ax = fig.axes[0]
    markers = [ln for ln in ax.lines if ln.get_marker() == "o"]
    assert len(markers) == 3                         # one point per group
    assert len(ax.containers) == 3                   # one errorbar per group
    # the y-axis names the estimated rate, not the raw count column
    svg = compiler.figure_to_svg(fig)
    assert "rate (count / hours)" in svg
    compiler.close(fig)


def test_pointrange_has_no_significance_brackets():
    fig, res = _render_rate()
    svg = compiler.figure_to_svg(fig)
    # significance brackets/stars are never drawn for the rate family
    assert "***" not in svg and "n.s." not in svg
    compiler.close(fig)


def test_pointrange_horizontal_orientation():
    fig, res = _render_rate(horizontal=True)
    ax = fig.axes[0]
    assert len([ln for ln in ax.lines if ln.get_marker() == "o"]) == 3
    svg = compiler.figure_to_svg(fig)
    assert "rate (count / hours)" in svg           # value axis is X here
    compiler.close(fig)
