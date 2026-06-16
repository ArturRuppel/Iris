"""§5 structural axis: paired numeric tests (paired t / Wilcoxon).

Pairing is derived from the spine (hierarchy.pairing) — no user declaration.
Ground truth is pingouin/scipy; these assert the engine picks the structural axis
from the pairing verdict, aligns pairs correctly, and reports the right cell.
"""
import numpy as np
import pandas as pd
import pingouin as pg
import pytest
from scipy import stats as sps

from iris_engine import stats
from iris_engine.stats import _col   # version-robust pingouin column access


# subject ⊃ rep; `group` is the comparison qualifier (orthogonal to the spine).
# Paired: every subject is measured under both A and B → pairing across subjects.
def _paired_df(seed=0, n_subjects=15, reps=3, effect=2.0):
    rng = np.random.default_rng(seed)
    rows = []
    for s in range(n_subjects):
        base = rng.normal(10, 2)                       # subject's own level
        for grp, shift in (("A", 0.0), ("B", effect)):
            for r in range(reps):
                rows.append({"subject": f"s{s}", "rep": r, "group": grp,
                             "y": base + shift + rng.normal(0, 0.5)})
    return pd.DataFrame(rows)


PAIRING = {"qualifier": "group", "verdict": "paired", "across": "subject",
           "unit_cols": ["subject"], "n_units": 15, "n_complete": 15,
           "levels": ["A", "B"]}


def _unit_means(df, levels=("A", "B")):
    cell = df.groupby(["subject", "group"], observed=True)["y"].mean().unstack()
    return cell[levels[0]].to_numpy(float), cell[levels[1]].to_numpy(float)


# ── structural axis selection ─────────────────────────────────────────────────

def test_paired_design_recommends_paired_t():
    df = _paired_df()
    res = stats.group_comparison(df, "group", "y", ["A", "B"], pairing=PAIRING)
    assert res["decision"]["structural"]["recommended"] == "paired"
    assert res["recommendation"]["test"] == "paired_t"   # normal differences
    assert res["result"]["test"] == "paired_t"


def test_no_pairing_recommends_independent():
    df = _paired_df()
    res = stats.group_comparison(df, "group", "y", ["A", "B"], pairing=None)
    assert res["decision"]["structural"]["recommended"] == "independent"
    assert res["result"]["test"] in ("welch_t", "mann_whitney")  # an independent cell


def test_unpaired_verdict_stays_independent():
    df = _paired_df()
    p = {**PAIRING, "verdict": "unpaired", "unit_cols": []}
    res = stats.group_comparison(df, "group", "y", ["A", "B"], pairing=p)
    assert res["decision"]["structural"]["recommended"] == "independent"


# ── paired t matches pingouin on the aligned pairs ────────────────────────────

def test_paired_t_matches_pingouin():
    df = _paired_df()
    a, b = _unit_means(df)
    ref = pg.ttest(a, b, paired=True).iloc[0]
    res = stats.group_comparison(df, "group", "y", ["A", "B"], pairing=PAIRING)
    r = res["result"]
    assert r["n"] == 15                                  # 15 pairs, not 90 rows
    assert r["t"] == pytest.approx(float(_col(ref, "T")))
    assert r["p"] == pytest.approx(float(_col(ref, "p_val", "p-val")))
    assert r["mean_diff"] == pytest.approx(float(np.mean(a - b)))
    g = pg.compute_effsize(a, b, paired=True, eftype="hedges")
    assert r["effect"]["value"] == pytest.approx(float(g))


def test_paired_n_counts_units_not_rows():
    df = _paired_df(n_subjects=8, reps=5)
    res = stats.group_comparison(df, "group", "y", ["A", "B"],
                                 pairing={**PAIRING, "n_units": 8, "n_complete": 8})
    assert res["result"]["n"] == 8                       # 8 subjects, not 80 rows
    assert "8 complete pairs" in res["methods_text"]


# ── Wilcoxon override + small-n robust default ────────────────────────────────

def test_wilcoxon_override_matches_pingouin():
    df = _paired_df()
    a, b = _unit_means(df)
    ref = pg.wilcoxon(a, b).iloc[0]
    res = stats.group_comparison(df, "group", "y", ["A", "B"],
                                 pairing=PAIRING, override="wilcoxon")
    r = res["result"]
    assert r["test"] == "wilcoxon"
    assert res["chosen_by"] == "user_override"
    assert r["W"] == pytest.approx(float(_col(ref, "W_val", "W-val")))
    assert r["p"] == pytest.approx(float(_col(ref, "p_val", "p-val")))
    assert r["effect"]["value"] == pytest.approx(float(_col(ref, "RBC")))


def test_small_paired_defaults_to_wilcoxon():
    df = _paired_df(n_subjects=5)                        # 5 pairs < 12 → robust
    res = stats.group_comparison(df, "group", "y", ["A", "B"],
                                 pairing={**PAIRING, "n_units": 5, "n_complete": 5})
    assert res["decision"]["assumption"]["recommended"] == "robust"
    assert res["recommendation"]["test"] == "wilcoxon"


# ── decision object records per-question provenance (§5) ──────────────────────

def test_decision_records_structural_override():
    df = _paired_df()
    # override to an independent test on paired data → structural is a user override
    res = stats.group_comparison(df, "group", "y", ["A", "B"],
                                 pairing=PAIRING, override="welch_t")
    d = res["decision"]
    assert d["structural"]["chosen"] == "independent"
    assert d["structural"]["recommended"] == "paired"
    assert d["structural"]["chosen_by"] == "user_override"
    assert res["result"]["test"] == "welch_t"


def test_paired_options_offered_only_when_paired():
    df = _paired_df()
    paired = stats.group_comparison(df, "group", "y", ["A", "B"], pairing=PAIRING)
    indep = stats.group_comparison(df, "group", "y", ["A", "B"], pairing=None)
    assert paired["decision"]["structural"]["options"] == ["independent", "paired"]
    assert indep["decision"]["structural"]["options"] == ["independent"]


# ── partial pairing drops incomplete units ────────────────────────────────────

def test_partial_pairing_drops_incomplete_units():
    df = _paired_df(n_subjects=10)
    df = df[~((df["subject"] == "s9") & (df["group"] == "B"))]   # drop one arm
    p = {**PAIRING, "verdict": "partially_paired", "n_units": 10, "n_complete": 9}
    res = stats.group_comparison(df, "group", "y", ["A", "B"], pairing=p)
    assert res["result"]["n"] == 9                       # s9 dropped (incomplete)
    assert res["decision"]["structural"]["recommended"] == "paired"


# ── guard: paired requested without structure ─────────────────────────────────

def test_paired_override_without_structure_errors():
    df = _paired_df()
    res = stats.group_comparison(df, "group", "y", ["A", "B"],
                                 pairing=None, override="paired_t")
    assert "error" in res


# ── end-to-end: /analyze threads the spine-derived pairing into the test ───────

from fastapi.testclient import TestClient  # noqa: E402
from iris_engine.main import app  # noqa: E402

client = TestClient(app)

_SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "group", "type": "categorical", "label": "Group", "levels": ["A", "B"]},
    {"name": "subject", "type": "identifier", "label": "Subject"},
    {"name": "rep", "type": "identifier", "label": "Rep"},
    {"name": "y", "type": "numeric", "label": "Y"},
]}


def _table():
    df = _paired_df(n_subjects=15)
    rows = [{**rec, "id": f"r{i}", "excluded": False}
            for i, rec in enumerate(df.to_dict("records"))]
    return {"schema": _SCHEMA, "rows": rows}


def _spec(spine):
    return {
        "spec_version": "2.0", "id": "p", "title": "p",
        "data": {"filter": [], "respect_exclusions": True},
        "reduce": {"steps": []},
        "hierarchy": {"spine": spine, "fn": {}},
        "encodings": {"x": {"column": "group"}, "y": {"column": "y"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "layers": [{"geom": "box", "params": {}}],
        "stats": {"family": "group_comparison", "test": "none",
                  "chosen_by": "inferred", "alternatives_offered": [],
                  "assumption_checks": [], "alpha": 0.05, "report": []},
        "annotations": {"significance_brackets": "auto", "show_n": False},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }


def test_endpoint_spine_drives_paired_test():
    r = client.post("/analyze", json={"table": _table(),
                                      "spec": _spec(["subject", "rep"])})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stat_model"]["pairing"]["verdict"] == "paired"
    assert body["stats"]["result"]["test"] == "paired_t"
    assert body["stats"]["result"]["n"] == 15            # pairs, not 90 rows


def test_endpoint_no_spine_is_independent():
    r = client.post("/analyze", json={"table": _table(), "spec": _spec([])})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["result"]["test"] in ("welch_t", "mann_whitney")
