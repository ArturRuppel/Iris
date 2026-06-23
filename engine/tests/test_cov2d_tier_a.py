# engine/tests/test_cov2d_tier_a.py
"""Tier A end-to-end: the absorbed graph reproduces the notebook's numbers."""
import cov2d_fixture as fx
import numpy as np
import pytest

from iris_engine import render as render_mod


def test_fixture_reference_is_paired_and_well_separated():
    ref = fx.paired_by_replicate_reference()
    assert ref["n"] == 3                      # N=3 replicates (experiments)
    # VimentinKO above NLS-mCherry in every replicate
    assert all(v > n for v, n in zip(ref["vk"], ref["nl"]))
    assert ref["p"] < 0.05


def _tier_a_spec(derive_log: bool = False) -> dict:
    steps = [{"kind": "filter",
              "conditions": [{"column": "value", "op": "not-null"}]}]
    if derive_log:
        steps.append({"kind": "derive", "column": "value", "expr": "log(value)"})
    steps.append({"kind": "join", "on": fx.KEY, "how": "inner",
                  "right": fx.right_table()})
    steps.append({"kind": "recode", "column": "class_label", "map": fx.CLASS_MAP})
    return {
        "spec_version": "2.0",
        "id": "cov2d-tier-a-size",
        "title": "COV2D Tier A — cell size",
        "data": {"filter": []},
        "reduce": {"steps": steps},
        "encodings": {"x": {"column": "class_label"}, "y": {"column": "value"},
                      "color": {"column": "class_label"}, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": fx.SPINE,
                      "fn": {lv: "median" for lv in fx.SPINE}},
        "layers": [{"geom": "violin", "level": ""},
                   {"geom": "dot", "level": "cell_id"},
                   {"geom": "summary", "level": "experiment_id"}],
        "stats": {"alpha": 0.05, "override": "paired_t"},
    }


def test_engine_graph_matches_notebook_paired_t_and_hedges_g():
    ref = fx.paired_by_replicate_reference()
    fig, res, df, schema, model, issues, level_tables = render_mod.render(
        fx.left_table(), _tier_a_spec())
    r = res["result"]
    assert r["test"] == "paired_t"
    assert model["pairing"]["verdict"] == "paired"
    assert model["pairing"]["across"] == "experiment_id"
    assert res["result"]["p"] == pytest.approx(ref["p"], abs=1e-12)
    assert res["result"]["effect"]["value"] == pytest.approx(ref["g"], abs=1e-12)
    assert abs(res["result"]["t"]) == pytest.approx(abs(ref["t"]), abs=1e-9)
    from iris_engine import compiler
    compiler.close(fig)


def test_default_chain_reproduces_experiment_grain_medians():
    ref = fx.paired_by_replicate_reference()
    _, _, _, _, _, _, level_tables = render_mod.render(
        fx.left_table(), _tier_a_spec())
    exp_tbl, _ = level_tables["experiment_id"]
    got = (exp_tbl.set_index(["experiment_id", "class_label"])["value"]
                  .unstack().reindex(columns=fx.LEVELS))
    want = ref["piv"].reindex(columns=fx.LEVELS)
    np.testing.assert_allclose(got.to_numpy(), want.to_numpy(), atol=1e-12)


def test_inner_join_drops_unclassified_then_log_derive_matches():
    # the join keeps only labelled cells; a pre-flatten log derive matches numpy
    _, res, df, _, _, _, _ = render_mod.render(
        fx.left_table(), _tier_a_spec(derive_log=True))
    # every retained raw row carries a (recoded) label and a logged value
    assert set(df["class_label"]) == set(fx.LEVELS)
    assert df["value"].min() < 10                # log compressed the 60-130 range
    assert res["result"]["test"] == "paired_t"
