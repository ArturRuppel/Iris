"""Phase 4: facets — small multiples via facet.row / facet.col.

v1 is describe-only whenever a facet is mapped (no per-facet test, no
multiple-comparisons correction) and renders a 2D grid of subplots with one
shared legend/colorbar/sup-labels for the whole figure. This file builds up
across the engine tasks: wiring/describe-only first, then the cell-count
guard, then the actual grid/gid behavior once the compiler supports it.
"""
import re

import pandas as pd
from fastapi.testclient import TestClient

from iris_engine import compiler, stats as stats_mod
from iris_engine.main import app

client = TestClient(app)

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "id", "type": "identifier", "label": "ID"},
    {"name": "treatment", "type": "categorical", "label": "Treatment",
     "levels": ["control", "drug_a"]},
    {"name": "site", "type": "categorical", "label": "Site",
     "levels": ["north", "south"]},
    {"name": "response", "type": "numeric", "label": "Response"},
]}


def make_table():
    rows = []
    i = 0
    for treatment in ("control", "drug_a"):
        for site in ("north", "south"):
            for v in range(5):
                i += 1
                rows.append({"id": f"r{i}", "treatment": treatment, "site": site,
                            "response": float(v + (3 if treatment == "drug_a" else 0))})
    return {"schema": SCHEMA, "rows": rows}


def make_spec(*, facet_row=None, facet_col=None, geom="box"):
    return {
        "spec_version": "2.1",
        "id": "facet_test", "title": "Facet test",
        "data": {"filter": []},
        "reduce": {"steps": []},
        "encodings": {
            "x": {"column": "treatment"}, "y": {"column": "response"},
            "color": None, "size": None, "shape": None,
        },
        "facet": {
            "row": {"column": facet_row} if facet_row else None,
            "col": {"column": facet_col} if facet_col else None,
            "share_x": True, "share_y": True,
        },
        "layers": [{"geom": geom, "params": {}}],
        "stats": {
            "family": "group_comparison", "test": "welch_t", "alpha": 0.05,
        },
        "annotations": {"significance_brackets": "auto", "show_n": True},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }


# ---------- wiring / describe-only ----------

def test_faceted_row_is_describe_only_end_to_end():
    r = client.post("/analyze", json={"table": make_table(),
                                       "spec": make_spec(facet_row="site")})
    body = r.json()
    assert r.status_code == 200, body
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert body["stat_model"]["test"] is None
    assert "<svg" in body["figure"]["svg"]


def test_faceted_col_is_describe_only_end_to_end():
    r = client.post("/analyze", json={"table": make_table(),
                                       "spec": make_spec(facet_col="site")})
    body = r.json()
    assert r.status_code == 200, body
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert body["stat_model"]["test"] is None


def test_unfaceted_spec_runs_real_test_unaffected():
    r = client.post("/analyze", json={"table": make_table(), "spec": make_spec()})
    body = r.json()
    assert r.status_code == 200, body
    assert body["stat_model"]["chosen_by"] == "inferred"
    assert body["stat_model"]["family"] == "group_comparison"


def test_health_serves_facet_cell_cap():
    r = client.get("/health")
    assert r.json()["registry"]["facet_cell_cap"] == 20


def test_facet_cell_cap_trips_end_to_end_via_analyze():
    # 21 site levels x 1 (no col facet) -> 21 cells > FACET_CELL_CAP (20)
    schema = {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier", "label": "ID"},
        {"name": "treatment", "type": "categorical", "label": "Treatment",
         "levels": ["control", "drug_a"]},
        {"name": "site", "type": "categorical", "label": "Site"},
        {"name": "response", "type": "numeric", "label": "Response"},
    ]}
    rows = []
    i = 0
    for s in range(21):
        for treatment in ("control", "drug_a"):
            i += 1
            rows.append({"id": f"r{i}", "treatment": treatment,
                        "site": f"s{s}", "response": float(i)})
    table = {"schema": schema, "rows": rows}
    spec = make_spec(facet_row="site")
    spec["data"] = {"filter": []}
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 422
    assert "facet" in r.json()["detail"].lower() or "21" in r.json()["detail"]


# ---------- grid rendering (Tasks #10/#11) ----------

def _site_effect_table():
    """Unlike make_table(), south is shifted +10 over north so per-cell
    rendering can be distinguished from pooled (whole-dataset) rendering."""
    rows = []
    i = 0
    for treatment in ("control", "drug_a"):
        for site in ("north", "south"):
            shift = 10.0 if site == "south" else 0.0
            for v in range(5):
                i += 1
                rows.append({"id": f"r{i}", "treatment": treatment, "site": site,
                            "response": shift + v + (3 if treatment == "drug_a" else 0)})
    return pd.DataFrame(rows)


def _all_collection_ys(ax):
    ys = []
    for coll in ax.collections:
        offs = coll.get_offsets()
        if len(offs):
            ys.extend(offs[:, 1])
    return ys


def test_faceted_comparison_grid_shape_row_and_col():
    df = _site_effect_table()
    spec = make_spec(facet_row="site", facet_col="treatment", geom="dot")
    pooled = stats_mod.describe_groups(df, "treatment", "response",
                                       levels=["control", "drug_a"])
    fig = compiler.build_comparison_figure(df, SCHEMA, spec, pooled)
    assert len(fig.axes) == 4   # 2 site levels x 2 treatment levels


def test_faceted_comparison_draws_marks_in_every_cell():
    df = _site_effect_table()
    spec = make_spec(facet_row="site", geom="dot")
    pooled = stats_mod.describe_groups(df, "treatment", "response",
                                       levels=["control", "drug_a"])
    fig = compiler.build_comparison_figure(df, SCHEMA, spec, pooled)
    # every facet cell draws marks; across all cells every raw row is drawn once
    total = sum(len(_all_collection_ys(ax)) for ax in fig.axes)
    assert total == len(df)
    assert all(len(_all_collection_ys(ax)) > 0 for ax in fig.axes)
    compiler.close(fig)


def test_faceted_comparison_draws_per_cell_data_not_pooled():
    df = _site_effect_table()
    spec = make_spec(facet_row="site", geom="dot")
    pooled = stats_mod.describe_groups(df, "treatment", "response",
                                       levels=["control", "drug_a"])
    fig = compiler.build_comparison_figure(df, SCHEMA, spec, pooled)
    north_ax, south_ax = fig.axes[0], fig.axes[1]   # sorted: north, south
    north_ys = _all_collection_ys(north_ax)
    south_ys = _all_collection_ys(south_ax)
    assert min(south_ys) - min(north_ys) >= 9   # south is shifted +10


def test_unfaceted_comparison_is_single_axes():
    df = _site_effect_table()
    spec = make_spec(geom="dot")
    pooled = stats_mod.describe_groups(df, "treatment", "response",
                                       levels=["control", "drug_a"])
    fig = compiler.build_comparison_figure(df, SCHEMA, spec, pooled)
    assert len(fig.axes) == 1


def test_faceted_scatter_grid_shape_and_marks_per_cell():
    schema = {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier", "label": "ID"},
        {"name": "site", "type": "categorical", "label": "Site",
         "levels": ["north", "south"]},
        {"name": "x", "type": "numeric", "label": "X"},
        {"name": "y", "type": "numeric", "label": "Y"},
    ]}
    rows = [{"id": f"r{i}", "site": "north" if i % 2 else "south",
             "x": float(i), "y": float(i)} for i in range(10)]
    df = pd.DataFrame(rows)
    spec = make_spec(facet_row="site")
    spec["encodings"] = {"x": {"column": "x"}, "y": {"column": "y"},
                         "color": None, "size": None, "shape": None}
    pooled = stats_mod.describe_pairs(df, "x", "y")
    fig = compiler.build_scatter_figure(df, schema, spec, pooled)
    assert len(fig.axes) == 2
    total = sum(len(_all_collection_ys(ax)) for ax in fig.axes)
    assert total == len(df)   # every row drawn once across the two cells


def test_faceted_tile_grid_shape_and_per_cell_counts():
    schema = {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier", "label": "ID"},
        {"name": "site", "type": "categorical", "label": "Site",
         "levels": ["north", "south"]},
        {"name": "treatment", "type": "categorical", "label": "Treatment",
         "levels": ["control", "drug_a"]},
        {"name": "outcome", "type": "categorical", "label": "Outcome",
         "levels": ["yes", "no"]},
    ]}
    rows = []
    i = 0
    # north: all "yes"; south: all "no" -- so per-cell counts must differ
    for site, outcome in (("north", "yes"), ("south", "no")):
        for treatment in ("control", "drug_a"):
            for _ in range(3):
                i += 1
                rows.append({"id": f"r{i}", "site": site, "treatment": treatment,
                            "outcome": outcome})
    df = pd.DataFrame(rows)
    spec = make_spec(facet_row="site")
    spec["encodings"] = {"x": {"column": "treatment"}, "y": {"column": "outcome"},
                         "color": None, "size": None, "shape": None}
    pooled = stats_mod.contingency_counts(df, "treatment", "outcome",
                                          ["control", "drug_a"], ["yes", "no"])
    fig = compiler.build_tile_figure(df, schema, spec, pooled)
    assert len(fig.axes) >= 2   # 2 row cells (+ shared colorbar axes)
