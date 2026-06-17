"""§5 contingency inference: chi-square + Fisher's exact (independent cell).

Ground truth is scipy (chi2_contingency / fisher_exact); these assert the engine
orchestrates them correctly and routes the small-sample rule the way §5 specifies.
"""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy import stats as sps

from iris_engine.main import app
from iris_engine.stats import contingency_test, contingency_counts

client = TestClient(app)


def make_df(x_levels, y_levels, counts):
    """counts[yi][xi] rows → a long DataFrame of (x, y) observations."""
    rows = []
    for yi, yl in enumerate(y_levels):
        for xi, xl in enumerate(x_levels):
            rows += [{"x": xl, "y": yl}] * counts[yi][xi]
    return pd.DataFrame(rows)


# ── chi-square ────────────────────────────────────────────────────────────────

def test_chi_square_matches_scipy():
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    counts = [[10, 5], [10, 15]]            # rows = y_levels (resp, non)
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl)

    obs = np.array(counts, dtype=float)
    chi2, p, dof, _ = sps.chi2_contingency(obs, correction=False)
    assert res["result"]["test"] == "chi_square"
    assert res["recommendation"]["test"] == "chi_square"
    assert res["result"]["chi2"] == pytest.approx(chi2)
    assert res["result"]["p"] == pytest.approx(p)
    assert res["result"]["dof"] == dof
    assert res["result"]["n"] == 40


def test_cramers_v_formula():
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    counts = [[10, 5], [10, 15]]
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl)
    obs = np.array(counts, dtype=float)
    chi2, *_ = sps.chi2_contingency(obs, correction=False)
    expected_v = np.sqrt(chi2 / (obs.sum() * (min(obs.shape) - 1)))
    eff = res["result"]["effect"]
    assert eff["name"] == "cramers_v"
    assert eff["value"] == pytest.approx(expected_v)
    assert eff["ci"] is None


def test_larger_table_recommends_chi_square_even_if_sparse():
    xl, yl = ["a", "b", "c"], ["resp", "non"]
    counts = [[1, 2, 1], [2, 1, 2]]         # small expected, but 2×3 → chi-square
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl)
    assert res["recommendation"]["test"] == "chi_square"
    assert res["result"]["test"] == "chi_square"


# ── Fisher's exact ────────────────────────────────────────────────────────────

def test_fisher_recommended_for_2x2_small_expected():
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    counts = [[8, 2], [1, 9]]               # total 20, an expected cell = 4.5 < 5
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl)
    obs = np.array(counts, dtype=float)
    _, p = sps.fisher_exact(obs)
    assert res["recommendation"]["test"] == "fisher_exact"
    assert res["result"]["test"] == "fisher_exact"
    assert res["result"]["p"] == pytest.approx(p)
    assert res["result"]["odds_ratio"] == pytest.approx((8 * 9) / (2 * 1))
    ci = res["result"]["effect"]["ci"]
    assert ci[0] < res["result"]["odds_ratio"] < ci[1]


def test_2x2_large_expected_recommends_chi_square():
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    counts = [[20, 10], [10, 20]]           # all expected ≥ 5
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl)
    assert res["recommendation"]["test"] == "chi_square"


def test_fisher_zero_cell_uses_haldane_for_finite_ci():
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    counts = [[0, 6], [7, 3]]               # a zero cell → Haldane +0.5 for OR/CI
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl, override="fisher_exact")
    or_val = res["result"]["odds_ratio"]
    ci = res["result"]["effect"]["ci"]
    assert np.isfinite(or_val)
    assert all(np.isfinite(b) for b in ci)
    # +0.5 to every cell: (0.5*3.5)/(6.5*7.5)
    assert or_val == pytest.approx((0.5 * 3.5) / (6.5 * 7.5))


# ── overrides & routing ───────────────────────────────────────────────────────

def test_override_fisher_on_2x2_takes_effect():
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    counts = [[20, 10], [10, 20]]
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl, override="fisher_exact")
    # the pin takes effect; chosen_by stays neutral (no deviation marker)
    assert res["result"]["test"] == "fisher_exact"
    assert res["chosen_by"] == "recommendation_accepted"


def test_override_fisher_falls_back_to_chi_square_when_not_2x2():
    xl, yl = ["a", "b", "c"], ["resp", "non"]
    counts = [[10, 8, 6], [6, 8, 10]]
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl, override="fisher_exact")
    assert res["result"]["test"] == "chi_square"   # Fisher is 2×2-only


def test_degenerate_single_level_errors():
    xl, yl = ["only"], ["resp", "non"]
    df = make_df(xl, yl, [[5], [5]])
    res = contingency_test(df, "x", "y", xl, yl)
    assert "error" in res


def test_empty_levels_dropped_before_test():
    # an extra x-level with no observations must not break chi2_contingency
    xl, yl = ["ctrl", "drug", "ghost"], ["resp", "non"]
    counts = [[10, 5, 0], [10, 15, 0]]
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl)
    assert "error" not in res
    assert res["result"]["test"] == "chi_square"
    assert res["result"]["n"] == 40                 # ghost contributed nothing
    assert res["counts"][0] == [10, 5, 0]           # full matrix kept for the tile


# ── still returns tile-rendering fields ───────────────────────────────────────

def test_keeps_counts_for_the_tile():
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    counts = [[10, 5], [10, 15]]
    df = make_df(xl, yl, counts)
    res = contingency_test(df, "x", "y", xl, yl)
    base = contingency_counts(df, "x", "y", xl, yl)
    assert res["counts"] == base["counts"]
    assert res["x_levels"] == xl and res["y_levels"] == yl
    assert res["total"] == base["total"]


# ── endpoint wiring ───────────────────────────────────────────────────────────

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "treatment", "type": "categorical", "label": "Treatment",
     "levels": ["ctrl", "drug"]},
    {"name": "outcome", "type": "categorical", "label": "Outcome",
     "levels": ["resp", "non"]},
]}


def _rows(counts):
    xl, yl = ["ctrl", "drug"], ["resp", "non"]
    out = []
    for yi, yl_ in enumerate(yl):
        for xi, xl_ in enumerate(xl):
            out += [{"treatment": xl_, "outcome": yl_, "excluded": False}] \
                * counts[yi][xi]
    return out


def _spec(chosen_by, test="none"):
    return {
        "spec_version": "2.0", "id": "c", "title": "c",
        "data": {"filter": [], "respect_exclusions": True},
        "reduce": {"steps": []},
        "encodings": {"x": {"column": "treatment"}, "y": {"column": "outcome"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "layers": [{"geom": "tile", "params": {}}],
        "stats": {"family": "contingency", "test": test, "chosen_by": chosen_by,
                  "alternatives_offered": [], "assumption_checks": [],
                  "alpha": 0.05, "report": []},
        "annotations": {"significance_brackets": "auto", "show_n": False},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }


def test_endpoint_runs_chi_square_and_still_renders():
    table = {"schema": SCHEMA, "rows": _rows([[20, 10], [10, 20]])}
    r = client.post("/analyze", json={"table": table, "spec": _spec("inferred")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stat_model"]["family"] == "contingency"
    assert body["stats"]["result"]["test"] == "chi_square"
    assert "p" in body["stats"]["result"]
    assert body["figure"]["svg"].startswith("<")  # tile still rendered


def test_endpoint_describe_only_runs_no_test():
    table = {"schema": SCHEMA, "rows": _rows([[20, 10], [10, 20]])}
    r = client.post("/analyze", json={"table": table, "spec": _spec("describe_only")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["result"]["test"] == "none"
    assert body["stats"]["chosen_by"] == "describe_only"
