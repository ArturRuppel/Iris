"""Multi-group comparison (>2 levels): omnibus test + corrected pairwise.

group_comparison delegates to multi_group_comparison once a factor has more than
two levels. Ground truth is recomputed independently with raw scipy/pingouin —
never echoed from the engine — so an assertion can't be a tautology. Covers test
selection (ANOVA vs Kruskal), the omnibus statistic, the pairwise table shape +
multiplicity correction, and the override channel.
"""
import json
import re

import numpy as np
import pandas as pd
import pingouin as pg
import pytest
from scipy import stats as sps

from iris_engine import compiler, document, main, stats


def _three_group_df(seed=0, n=40):
    """Three well-separated normal groups (so ANOVA is selected and significant)."""
    rng = np.random.default_rng(seed)
    rows = []
    for grp, mean in (("A", 0.0), ("B", 3.0), ("C", 6.0)):
        for _ in range(n):
            rows.append({"g": grp, "y": rng.normal(mean, 1.0)})
    return pd.DataFrame(rows)


def _skewed_three_group_df(seed=1, n=8):
    """Small, skewed groups → the rank-based omnibus (Kruskal) is recommended."""
    rng = np.random.default_rng(seed)
    rows = []
    for grp, scale in (("A", 1.0), ("B", 2.0), ("C", 4.0)):
        for _ in range(n):
            rows.append({"g": grp, "y": rng.exponential(scale)})
    return pd.DataFrame(rows)


# ── test selection ────────────────────────────────────────────────────────────

def test_three_normal_groups_select_one_way_anova():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"])
    assert res["result"]["test"] == "one_way_anova"
    assert res["chosen_by"] == "recommendation_accepted"
    assert res["result"]["k"] == 3


def test_small_skewed_groups_select_kruskal():
    df = _skewed_three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"])
    assert res["result"]["test"] == "kruskal"


def test_override_pins_kruskal_on_normal_data():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"], override="kruskal")
    assert res["result"]["test"] == "kruskal"
    assert res["chosen_by"] == "user_override"


def test_stale_two_group_override_is_ignored_for_multi():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"], override="welch_t")
    # a 2-group override doesn't apply with >2 levels — falls back to recommended
    assert res["result"]["test"] == "one_way_anova"
    assert res["chosen_by"] == "recommendation_accepted"


# ── omnibus statistic matches an independent recompute ──────────────────────────

def test_anova_F_matches_scipy():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"])
    groups = [df.loc[df.g == lv, "y"].to_numpy(float) for lv in ("A", "B", "C")]
    F, p = sps.f_oneway(*groups)
    r = res["result"]
    assert r["F"] == pytest.approx(F, rel=1e-6)
    assert r["p"] == pytest.approx(p, rel=1e-6)
    assert (r["df_between"], r["df_within"]) == (2, len(df) - 3)


def test_kruskal_H_matches_scipy():
    df = _skewed_three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"], override="kruskal")
    groups = [df.loc[df.g == lv, "y"].to_numpy(float) for lv in ("A", "B", "C")]
    H, p = sps.kruskal(*groups)
    r = res["result"]
    assert r["H"] == pytest.approx(H, rel=1e-6)
    assert r["p"] == pytest.approx(p, rel=1e-6)


# ── pairwise table: shape, correction, ordering ────────────────────────────────

def test_pairwise_covers_every_pair():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"])
    pairs = {frozenset((pw["a"], pw["b"])) for pw in res["result"]["pairwise"]}
    assert pairs == {frozenset(("A", "B")), frozenset(("A", "C")),
                     frozenset(("B", "C"))}
    assert res["result"]["correction"] == "tukey"


def test_tukey_adjusted_p_matches_pingouin():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"])
    tuk = pg.pairwise_tukey(data=df, dv="y", between="g")
    ref = {frozenset((str(r["A"]), str(r["B"]))): float(stats._col(r, "p-tukey", "p_tukey"))
           for _, r in tuk.iterrows()}
    for pw in res["result"]["pairwise"]:
        assert pw["p_adj"] == pytest.approx(ref[frozenset((pw["a"], pw["b"]))], rel=1e-9)


def test_holm_correction_inflates_pairwise_p():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"], override="kruskal")
    assert res["result"]["correction"] == "holm"
    # Holm-adjusted p is never smaller than the raw p
    for pw in res["result"]["pairwise"]:
        assert pw["p_adj"] >= pw["p"] - 1e-12


def test_stars_track_adjusted_p():
    df = _three_group_df()
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"])
    for pw in res["result"]["pairwise"]:
        assert pw["stars"] == stats._p_stars(pw["p_adj"])


# ── figure: stacked significance brackets ──────────────────────────────────────

def _render(df, geom="box", horizontal=False, show_significance=True):
    rows = json.loads(df.to_json(orient="records"))
    for i, r in enumerate(rows, 1):
        r["id"] = str(i)
        r["excluded"] = False
    schema = document._infer_schema(df)
    enc = ({"x": {"column": "y"}, "y": {"column": "g"}} if horizontal
           else {"x": {"column": "g"}, "y": {"column": "y"}})
    enc.update({"color": None, "size": None, "shape": None})
    spec = {"spec_version": "2.0", "title": "t", "encodings": enc,
            "layers": [{"geom": geom, "params": {}}],
            "style": {"overrides": {"show_significance": show_significance}},
            "stats": {"alpha": 0.05}}
    fig, *_ = main._run({"schema": schema, "rows": rows}, spec)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return svg


def _bracket_labels(svg):
    # matplotlib (svg.fonttype=none) emits each text string as an SVG comment
    return re.findall(r"<!-- (\*{1,3}|ns) -->", svg)


def test_three_groups_draw_one_bracket_per_pair():
    svg = _render(_three_group_df())
    assert len(_bracket_labels(svg)) == 3  # one per pairwise comparison


def test_horizontal_multi_group_brackets_drawn():
    svg = _render(_three_group_df(), horizontal=True)
    assert len(_bracket_labels(svg)) == 3


def test_show_significance_off_suppresses_brackets():
    svg = _render(_three_group_df(), show_significance=False)
    assert _bracket_labels(svg) == []


# ── degenerate input ───────────────────────────────────────────────────────────

def test_singleton_group_errors():
    df = pd.DataFrame({"g": ["A", "A", "B", "B", "C"], "y": [1.0, 2, 3, 4, 5]})
    res = stats.group_comparison(df, "g", "y", ["A", "B", "C"])
    assert "error" in res


def test_cat_levels_keeps_undeclared_present_values():
    # regression (reduction-collapse.iris): a value living in the data but
    # absent from the schema's declared levels must still get its own box, else
    # relaxing a filter that hid it leaves the axis stuck at the declared count.
    schema = {"columns": [{"name": "condition", "type": "categorical",
                           "levels": ["ctrl", "trt"]}]}
    df = pd.DataFrame({"condition": ["blank", "ctrl", "trt", "blank"]})
    # declared order first, then the undeclared "blank" appended (not dropped)
    assert compiler._cat_levels(df, schema, "condition") == ["ctrl", "trt", "blank"]
    # filter still applied → only the declared, present levels
    df2 = pd.DataFrame({"condition": ["ctrl", "trt"]})
    assert compiler._cat_levels(df2, schema, "condition") == ["ctrl", "trt"]
