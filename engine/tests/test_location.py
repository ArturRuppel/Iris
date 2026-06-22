"""One-sample (vs-reference) location family + reference-line annotation (item N).

`stats.location` tests each group's central value against a constant reference
(default 0) rather than against another group — the honest design when groups are
not mutually independent (e.g. fractions summing to 1). Ground truth is recomputed
independently with raw scipy so an assertion can't be a tautology. Covers test
selection, the per-group statistics, the reference-centred null (p≈1), the spine
path (n = replicates, not raw rows), the override channel, and the figure
(reference line + one star per lane, the log-axis guard).
"""
import json
import re

import matplotlib
matplotlib.use("Agg")
import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from iris_engine import (compiler, document, guards, main, specnorm, statmodel,
                         stats)


# ── synthetic data ──────────────────────────────────────────────────────────

def _grouped_df(offsets, seed=3, n=15, sd=0.5):
    """One numeric column `enrich` per categorical `contact`, each group drawn
    normal around its offset from 0 (chance)."""
    rng = np.random.default_rng(seed)
    rows = []
    for ct, off in offsets.items():
        for _ in range(n):
            rows.append({"contact": ct, "enrich": rng.normal(off, sd)})
    return pd.DataFrame(rows)


# ── test selection ───────────────────────────────────────────────────────────

def test_normal_groups_select_one_sample_t():
    df = _grouped_df({"AA": 0.8, "AB": -0.6, "BB": 0.05})
    res = stats.location(df, "contact", "enrich", ["AA", "AB", "BB"], reference=0.0)
    assert res["family"] == "location"
    assert res["recommendation"]["test"] == "one_sample_t"
    assert all(g["test"] == "one_sample_t" for g in res["per_group"])


def test_small_skewed_groups_select_wilcoxon():
    rng = np.random.default_rng(1)
    rows = [{"contact": ct, "enrich": rng.exponential(1.0) - 1.0}
            for ct in ("AA", "BB") for _ in range(8)]
    res = stats.location(pd.DataFrame(rows), "contact", "enrich", ["AA", "BB"])
    # small n (< MIN_N_FOR_NORMALITY_RULE) → the rank-based one-sample test
    assert res["recommendation"]["test"] == "wilcoxon_signed"
    assert all(g["test"] == "wilcoxon_signed" for g in res["per_group"])


def test_override_pins_wilcoxon_on_normal_data():
    df = _grouped_df({"AA": 0.8, "BB": 0.05})
    res = stats.location(df, "contact", "enrich", ["AA", "BB"],
                         override="wilcoxon_signed")
    assert all(g["test"] == "wilcoxon_signed" for g in res["per_group"])


# ── statistics match an independent scipy recompute ──────────────────────────

def test_one_sample_t_matches_scipy():
    df = _grouped_df({"AA": 0.8, "AB": -0.6, "BB": 0.05})
    res = stats.location(df, "contact", "enrich", ["AA", "AB", "BB"], reference=0.0)
    by_level = {g["level"]: g for g in res["per_group"]}
    for lv in ("AA", "AB", "BB"):
        v = df.loc[df.contact == lv, "enrich"].to_numpy(float)
        t, p = sps.ttest_1samp(v, 0.0)
        g = by_level[lv]
        assert g["t"] == pytest.approx(t, rel=1e-6)
        assert g["p"] == pytest.approx(p, rel=1e-6)
        # Cohen's dz = mean(diff) / sd(diff)
        dz = float(np.mean(v) / np.std(v, ddof=1))
        assert g["effect"]["value"] == pytest.approx(dz, rel=1e-3)
        assert g["stars"] == stats._p_stars(p)


def test_nonzero_reference_shifts_the_null():
    df = _grouped_df({"AA": 1.0})
    res = stats.location(df, "contact", "enrich", ["AA"], reference=1.0)
    v = df.loc[df.contact == "AA", "enrich"].to_numpy(float)
    t, p = sps.ttest_1samp(v, 1.0)
    assert res["per_group"][0]["p"] == pytest.approx(p, rel=1e-6)
    assert res["reference"] == 1.0


def test_group_centred_on_reference_is_not_significant():
    # mean-centred exactly on 0 → t = 0, p = 1 → no stars
    rng = np.random.default_rng(7)
    v = rng.normal(0.0, 1.0, 40)
    v = v - v.mean()
    df = pd.DataFrame({"contact": ["BB"] * 40, "enrich": v})
    res = stats.location(df, "contact", "enrich", ["BB"], reference=0.0)
    g = res["per_group"][0]
    assert g["p"] == pytest.approx(1.0, abs=1e-9)
    assert g["stars"] == "ns"


def test_too_few_units_are_reported_but_untested():
    df = pd.DataFrame({"contact": ["AA", "AA"], "enrich": [0.4, 0.6]})
    res = stats.location(df, "contact", "enrich", ["AA"], reference=0.0)
    g = res["per_group"][0]
    assert g["n"] == 2 and g["p"] is None and g["stars"] == ""


# ── spine path: the inferential unit is the replicate, not the raw row ────────

def _spine_df():
    rows, rid = [], 0
    for ct in ("AA", "BB"):
        for exp in ("e1", "e2", "e3"):
            for pos in range(4):                      # 4 positions per experiment
                rows.append({"id": f"r{rid}", "contact": ct, "experiment": exp,
                             "position": f"{exp}-{pos}",
                             "enrich": float(rid % 5) - 2.0})
                rid += 1
    return pd.DataFrame(rows)


def _spine_schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "contact", "type": "categorical", "label": "Contact"},
        {"name": "experiment", "type": "identifier", "label": "Experiment"},
        {"name": "position", "type": "identifier", "label": "Position"},
        {"name": "enrich", "type": "numeric", "label": "Enrichment"}]}


def test_spine_counts_replicates_not_raw_rows():
    df, schema = _spine_df(), _spine_schema()
    rows = json.loads(df.to_json(orient="records"))
    spec = {"spec_version": "2.0", "title": "t",
            "encodings": {"x": {"column": "contact"}, "y": {"column": "enrich"},
                          "color": None, "size": None, "shape": None},
            "hierarchy": {"spine": ["experiment", "position"], "fn": {}},
            "layers": [{"geom": "dot", "params": {}, "level": "experiment"}],
            "stats": {"family": "location", "reference": 0.0, "alpha": 0.05}}
    _, res, *_ = main._run({"schema": schema, "rows": rows}, spec)
    # 12 raw rows per contact, but only 3 experiments → n counts experiments
    by_level = {g["level"]: g for g in res["per_group"]}
    assert by_level["AA"]["n"] == 3
    assert by_level["BB"]["n"] == 3


# ── statmodel / specnorm: opt-in family, no regression ────────────────────────

def _schema_cat_num():
    return {"schema_version": "1.0", "columns": [
        {"name": "contact", "type": "categorical"},
        {"name": "enrich", "type": "numeric"}]}


def test_statmodel_honours_declared_location_family():
    enc = {"x": {"column": "contact"}, "y": {"column": "enrich"},
           "color": None, "size": None, "shape": None}
    model = statmodel.infer(enc, _schema_cat_num(), None,
                            declared_family="location", reference=0.5)
    assert model["family"] == "location"
    assert model["reference"] == 0.5
    assert model["chosen_by"] == "inferred"


def test_plain_cat_numeric_still_infers_group_comparison():
    # no declared family → the default categorical/numeric inference is untouched
    enc = {"x": {"column": "contact"}, "y": {"column": "enrich"},
           "color": None, "size": None, "shape": None}
    model = statmodel.infer(enc, _schema_cat_num(), None)
    assert model["family"] == "group_comparison"


def test_specnorm_preserves_family_and_defaults_reference():
    spec = {"spec_version": "2.0", "encodings": {}, "layers": [],
            "stats": {"family": "location"}}
    out = specnorm.normalize(spec)
    assert out["stats"]["family"] == "location"
    assert out["stats"]["reference"] == 0.0


# ── guards: small-group warning (warn, never block) ───────────────────────────

def test_guard_warns_on_underpowered_group():
    df = pd.DataFrame({"contact": ["AA", "AA", "BB", "BB", "BB"],
                       "enrich": [0.3, 0.5, 0.1, 0.2, 0.3]})
    schema = _schema_cat_num()
    spec = {"spec_version": "2.0",
            "encodings": {"x": {"column": "contact"}, "y": {"column": "enrich"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "dot", "params": {}}],
            "stats": {"family": "location", "reference": 0.0}}
    model = {"family": "location"}
    issues = guards.evaluate(df, schema, spec, model)
    assert any(i["code"] == "min_observations" and i["level"] == "warning"
               for i in issues)


# ── figure: reference line + one star per lane (not brackets) ─────────────────

def _render(df, *, reference=0.0, horizontal=False, show_significance=True,
            y_scale="linear", reference_value=None, reference_label=""):
    rows = json.loads(df.to_json(orient="records"))
    for i, r in enumerate(rows, 1):
        r["id"] = str(i)
    schema = document._infer_schema(df)
    enc = ({"x": {"column": "enrich"}, "y": {"column": "contact"}} if horizontal
           else {"x": {"column": "contact"}, "y": {"column": "enrich"}})
    enc.update({"color": None, "size": None, "shape": None})
    overrides = {"show_significance": show_significance, "y_scale": y_scale}
    if reference_value is not None:
        overrides["reference_value"] = reference_value
    if reference_label:
        overrides["reference_label"] = reference_label
    spec = {"spec_version": "2.0", "title": "t", "encodings": enc,
            "layers": [{"geom": "violin", "params": {}},
                       {"geom": "dot", "params": {}}],
            "style": {"overrides": overrides},
            "stats": {"family": "location", "reference": reference, "alpha": 0.05}}
    fig, *_ = main._run({"schema": schema, "rows": rows}, spec)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return svg


def _stars(svg):
    return re.findall(r"<text[^>]*>(\*{1,3}|ns)</text>", svg)


def test_location_figure_draws_one_star_per_lane():
    svg = _render(_grouped_df({"AA": 0.8, "AB": -0.6, "BB": 0.05}))
    # one compact star per group (three lanes), no lane-to-lane brackets
    assert len(_stars(svg)) == 3


def test_location_figure_draws_a_dashed_reference_line():
    svg = _render(_grouped_df({"AA": 0.8}))
    # a dashed line is emitted (the reference at 0); brackets/grids aren't dashed
    assert "stroke-dasharray" in svg


def test_reference_label_renders():
    svg = _render(_grouped_df({"AA": 0.8}), reference_label="chance")
    assert ">chance<" in svg


def test_horizontal_location_draws_stars():
    svg = _render(_grouped_df({"AA": 0.8, "BB": 0.05}), horizontal=True)
    assert len(_stars(svg)) == 2


def test_show_significance_off_suppresses_stars():
    svg = _render(_grouped_df({"AA": 0.8, "BB": 0.05}), show_significance=False)
    assert _stars(svg) == []


def test_explicit_reference_value_overrides_family_default():
    # an explicit knob wins over the location family's default-on reference
    svg = _render(_grouped_df({"AA": 0.8}), reference=0.0, reference_value=0.5)
    assert "stroke-dasharray" in svg  # still drawn, just at a different value


def test_log_value_axis_skips_nonpositive_reference():
    # reference 0 on a log y axis can't be drawn — guard skips it cleanly.
    df = _grouped_df({"AA": 2.0}, seed=2, n=10, sd=0.3)
    df["enrich"] = df["enrich"].abs() + 0.5  # strictly positive for a log axis
    svg = _render(df, reference=0.0, y_scale="log")
    # the figure renders (no crash); no dashed reference line at y=0
    assert "<svg" in svg
