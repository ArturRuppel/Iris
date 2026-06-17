"""Phase 3c: horizontal orientation (categorical y + numeric x).

Group-comparison geoms (dot/box/violin/bar/summary) render horizontally when
the encoding has numeric x + categorical y. The compiler swaps axis roles;
stats still group by the categorical column and measure the numeric one.
"""
import re

import numpy as np
import pytest
from fastapi.testclient import TestClient

from iris_engine import geoms, statmodel
from iris_engine.main import app

client = TestClient(app)

A = [72.1, 68.4, 75.3, 80.2, 69.9, 77.5, 74.0, 71.2, 66.8, 79.1,
     73.3, 70.6, 76.2, 68.0, 72.9, 75.8, 71.7, 69.3, 78.4, 74.6]
B = [61.2, 58.7, 65.1, 55.9, 63.4, 60.8, 57.2, 64.0, 59.5, 62.3,
     56.8, 66.2, 61.9, 58.1, 63.7, 60.0, 57.9, 65.5, 62.6, 59.3]

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "id", "type": "identifier", "label": "ID"},
    {"name": "treatment", "type": "categorical", "label": "Treatment",
     "levels": ["control", "drug_a"]},
    {"name": "response", "type": "numeric", "label": "Response"},
]}


def make_table():
    rows = []
    for i, v in enumerate(A, 1):
        rows.append({"id": f"r{i}", "treatment": "control",
                     "response": v, "excluded": False})
    for i, v in enumerate(B, 21):
        rows.append({"id": f"r{i}", "treatment": "drug_a",
                     "response": v, "excluded": False})
    return {"schema": SCHEMA, "rows": rows}


def make_horiz_spec(*geom_names):
    """Spec with categorical y (treatment) + numeric x (response) — horizontal."""
    names = geom_names or ("box",)
    return {
        "spec_version": "2.0",
        "id": "h_test", "title": "Horizontal test",
        "data": {"filter": [], "respect_exclusions": True},
        "reduce": {"steps": []},
        "encodings": {
            "x": {"column": "response"},    # numeric → value axis
            "y": {"column": "treatment"},   # categorical → group axis
            "color": None, "size": None, "shape": None,
        },
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "layers": [{"geom": g, "params": {}} for g in names],
        "stats": {
            "family": "group_comparison", "test": "welch_t",
            "chosen_by": "recommendation_accepted",
            "alternatives_offered": [], "assumption_checks": [],
            "alpha": 0.05, "report": [],
        },
        "annotations": {"significance_brackets": "auto", "show_n": True},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }


# ---------- geom registry ----------

def test_h_orient_flag_on_group_comparison_geoms():
    for g in ("dot", "summary", "box", "violin", "bar"):
        assert geoms.GEOMS[g].h_orient is True, g
    for g in ("scatter", "regression", "distribution"):
        assert geoms.GEOMS[g].h_orient is False, g


def test_registry_payload_carries_h_orient():
    payload = geoms.registry_payload()
    for g in ("dot", "summary", "box", "violin", "bar"):
        assert payload["geoms"][g]["h_orient"] is True, g
    assert payload["geoms"]["scatter"]["h_orient"] is False
    assert payload["geoms"]["distribution"]["h_orient"] is False


def test_existing_geom_keys_present():
    # the core geom keys must all still be present (histogram + density were
    # folded into the unified `distribution` geom)
    original = {"dot", "summary", "box", "violin", "bar",
                "scatter", "regression", "distribution"}
    assert original.issubset(set(geoms.GEOMS))


# ---------- statmodel ----------

def test_statmodel_infers_group_comparison_for_horizontal():
    schema = {"columns": [
        {"name": "response", "type": "numeric"},
        {"name": "treatment", "type": "categorical"},
    ]}
    encodings = {"x": {"column": "response"}, "y": {"column": "treatment"},
                 "color": None, "size": None, "shape": None}
    model = statmodel.infer(encodings, schema, None)
    assert model["family"] == "group_comparison"
    assert "treatment" in model["design"]
    assert model["factors"][0]["column"] == "treatment"
    assert model["factors"][0]["role"] == "group"


def test_statmodel_color_second_factor_uses_grouping_column():
    schema = {"columns": [
        {"name": "response", "type": "numeric"},
        {"name": "treatment", "type": "categorical"},
        {"name": "sex", "type": "categorical"},
    ]}
    encodings = {"x": {"column": "response"}, "y": {"column": "treatment"},
                 "color": {"column": "sex"}, "size": None, "shape": None}
    model = statmodel.infer(encodings, schema, None)
    # sex != treatment (grouping column), so color_second_factor warning fires
    codes = [i["code"] for i in model["issues"]]
    assert "color_second_factor" in codes
    # "treatment" must appear in the issue message, not "response"
    msg = next(i for i in model["issues"] if i["code"] == "color_second_factor")
    assert "treatment" in msg["message"]


# ---------- full render pipeline ----------

@pytest.mark.parametrize("geom_name", ["box", "violin", "bar", "dot", "summary"])
def test_horizontal_geoms_render(geom_name):
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_horiz_spec(geom_name)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "<svg" in body["figure"]["svg"]
    assert body["stat_model"]["family"] == "group_comparison"


def test_horizontal_stats_match_vertical_stats():
    """Same data via horizontal vs vertical spec → same p-value and summaries."""
    # vertical spec
    vert_spec = {
        "spec_version": "2.0", "id": "v", "title": "v",
        "data": {"filter": [], "respect_exclusions": True},
        "reduce": {"steps": []},
        "encodings": {"x": {"column": "treatment"}, "y": {"column": "response"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "layers": [{"geom": "box", "params": {}}],
        "stats": {"family": "group_comparison", "test": "welch_t",
                  "chosen_by": "recommendation_accepted",
                  "alternatives_offered": [], "assumption_checks": [],
                  "alpha": 0.05, "report": []},
        "annotations": {"significance_brackets": "auto", "show_n": True},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }
    rv = client.post("/analyze", json={"table": make_table(), "spec": vert_spec})
    rh = client.post("/analyze", json={"table": make_table(),
                                       "spec": make_horiz_spec("box")})
    assert rv.status_code == 200 and rh.status_code == 200
    vs, hs = rv.json()["stats"], rh.json()["stats"]
    assert vs["result"]["p"] == pytest.approx(hs["result"]["p"], rel=1e-6)
    # summaries should match (same groups, same n, same means)
    v_sums = {s["group"]: s for s in vs["summaries"]}
    h_sums = {s["group"]: s for s in hs["summaries"]}
    for grp in v_sums:
        assert v_sums[grp]["n"] == h_sums[grp]["n"]
        assert v_sums[grp]["mean"] == pytest.approx(h_sums[grp]["mean"], abs=1e-6)


def test_horizontal_dot_keeps_click_contract():
    """gid → row_ids contract holds for horizontal dot plots."""
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_horiz_spec("dot")})
    assert r.status_code == 200
    body = r.json()
    svg = body["figure"]["svg"]
    groups = body["figure"]["point_groups"]
    assert len(groups) == 2
    for g in groups:
        m = re.search(rf'<g id="{g["gid"]}"(.*?)</g>', svg, re.S)
        assert m, f"gid {g['gid']} missing from SVG"
        n_use = len(re.findall(r"<use\b", m.group(1)))
        assert n_use == len(g["row_ids"]), "one <use> per row required"


def test_horizontal_aggregate_geoms_have_no_point_groups():
    for geom_name in ("box", "violin", "bar", "summary"):
        r = client.post("/analyze", json={"table": make_table(),
                                          "spec": make_horiz_spec(geom_name)})
        assert r.status_code == 200, geom_name
        assert r.json()["figure"]["point_groups"] == [], geom_name


def test_horizontal_significance_bracket_drawn():
    """A horizontal two-group comparison draws its significance bracket on the
    value axis (the multi-comparison work re-introduced on-figure brackets). The
    two fixture groups are well separated, so the bracket label is significant."""
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_horiz_spec("box")})
    assert r.status_code == 200
    # matplotlib (svg.fonttype=none) emits each label's text as an SVG comment
    assert "<!-- *** -->" in r.json()["figure"]["svg"]


def test_horizontal_mixed_layers():
    """Box + dot layered horizontally renders without error."""
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_horiz_spec("box", "dot")})
    assert r.status_code == 200
    body = r.json()
    assert "<svg" in body["figure"]["svg"]
    # dot layer produces point groups even when combined with box
    assert len(body["figure"]["point_groups"]) == 2


def test_stat_model_returned_for_horizontal():
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_horiz_spec("box")})
    body = r.json()
    assert body["stat_model"]["family"] == "group_comparison"
    assert body["issues"] == []
