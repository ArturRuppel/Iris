"""Time-series support: a measure over an ordered numeric x.

Two geoms mirror the dot+summary pairing — `line` draws one per-unit trajectory
(units from the spine, not an aesthetic), `trend` draws the mean ± band over
units per timepoint. Both bind to the raw rows; the family is describe-only.

See docs/superpowers/specs/2026-06-17-time-series-support-design.md.
"""
import re

import pandas as pd
from fastapi.testclient import TestClient

from iris_engine import compiler, hierarchy
from iris_engine.main import app

client = TestClient(app)

SPINE = ["date", "position_id", "cell_id", "frame"]

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "id", "type": "identifier", "label": "ID"},
    {"name": "condition", "type": "categorical", "label": "Condition",
     "levels": ["ctrl", "ko"]},
    {"name": "date", "type": "identifier", "label": "Date"},
    {"name": "position_id", "type": "identifier", "label": "Position"},
    {"name": "cell_id", "type": "identifier", "label": "Cell"},
    {"name": "frame", "type": "numeric", "label": "Frame"},
    {"name": "area", "type": "numeric", "label": "Area"},
]}


def make_df():
    """Two conditions, each its own date (condition lives at the date level, as
    in cells_by_frame) × one position × two cells × four frames."""
    rows, rid = [], 0
    for cond, date in (("ctrl", "d1"), ("ko", "d2")):
        for cell in (1, 2):
            for frame in range(4):
                rid += 1
                rows.append({"id": f"r{rid}", "excluded": False,
                             "condition": cond, "date": date,
                             "position_id": "p0", "cell_id": cell,
                             "frame": float(frame),
                             "area": float(frame + (10 if cond == "ko" else 0)
                                           + cell)})
    return pd.DataFrame(rows)


def make_table():
    df = make_df()
    return {"schema": SCHEMA, "rows": df.to_dict("records")}


def make_spec(*, geoms=("line",), color=None, facet_row=None):
    return {
        "spec_version": "2.0", "id": "ts_test", "title": "TS",
        "data": {"filter": [], "respect_exclusions": True},
        "reduce": {"steps": []},
        "encodings": {
            "x": {"column": "frame"}, "y": {"column": "area"},
            "color": {"column": color} if color else None,
            "size": None, "shape": None,
        },
        "facet": {"row": {"column": facet_row} if facet_row else None,
                  "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": SPINE, "fn": {}},
        "layers": [{"geom": g, "params": {}} for g in geoms],
        "stats": {"family": "timeseries", "test": None,
                  "chosen_by": "describe_only", "alternatives_offered": [],
                  "assumption_checks": [], "alpha": 0.05, "report": []},
        "annotations": {"significance_brackets": "auto", "show_n": True},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }


# ---------- trajectory_units ----------

def test_trajectory_units_default_spine_is_unit_minus_frame():
    df = make_df()
    units = hierarchy.trajectory_units(df, SPINE, "frame", ["condition"])
    # one curve per (date, position_id, cell_id), styled by condition
    assert units == ["date", "position_id", "cell_id", "condition"]


def test_trajectory_units_off_spine_x_is_single_curve():
    df = make_df()
    # x not on the spine → no coarser unit → the whole (split) frame is one curve
    assert hierarchy.trajectory_units(df, SPINE, "area", ["condition"]) == ["condition"]
    assert hierarchy.trajectory_units(df, SPINE, "area", []) == []


def test_trajectory_units_no_spine_is_single_curve():
    df = make_df()
    assert hierarchy.trajectory_units(df, [], "frame", ["condition"]) == ["condition"]


def test_trajectory_units_drops_absent_columns():
    df = make_df()
    units = hierarchy.trajectory_units(df, SPINE + ["gone"], "frame", ["nope"])
    assert "gone" not in units and "nope" not in units


# ---------- rendering ----------

def _build(spec):
    df = make_df()
    spec["stat_model"] = {"family": "timeseries"}
    return compiler.build_timeseries_figure(df, SCHEMA, spec, {}, None)


def test_line_draws_one_curve_per_unit():
    fig = _build(make_spec(geoms=("line",)))
    # one Line2D per (cell) unit: 2 conditions × 2 cells = 4 curves
    lines = fig.axes[0].get_lines()
    assert len(lines) == 4
    compiler.close(fig)


def test_trend_draws_mean_line_and_band():
    fig = _build(make_spec(geoms=("trend",), color="condition"))
    ax = fig.axes[0]
    # one mean line per condition level
    assert len(ax.get_lines()) == 2
    # show_band defaults True → a fill_between collection per condition
    assert len(ax.collections) == 2
    compiler.close(fig)


def test_layered_line_under_trend():
    fig = _build(make_spec(geoms=("line", "trend"), color="condition"))
    ax = fig.axes[0]
    # 4 trajectory curves + 2 condition mean lines
    assert len(ax.get_lines()) == 6
    compiler.close(fig)


# ---------- end-to-end via /analyze ----------

def test_analyze_timeseries_is_describe_only():
    r = client.post("/analyze", json={"table": make_table(),
                                       "spec": make_spec(geoms=("line", "trend"),
                                                         color="condition")})
    body = r.json()
    assert r.status_code == 200, body
    assert body["stat_model"]["family"] == "timeseries"
    assert body["stat_model"]["test"] is None
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert body["stat_model"]["design"] == "area over frame"
    assert "<svg" in body["figure"]["svg"]
    assert "point_groups" not in body["figure"]


def test_analyze_numeric_numeric_without_ts_geom_is_correlation():
    # the same numeric/numeric encoding with a scatter layer stays correlation
    r = client.post("/analyze", json={"table": make_table(),
                                       "spec": make_spec(geoms=("scatter",))})
    body = r.json()
    assert r.status_code == 200, body
    assert body["stat_model"]["family"] == "correlation"


def test_line_over_point_cap_blocks():
    # a single huge curve trips the per-row point cap, like dot/scatter
    rows = [{"id": f"r{i}", "excluded": False, "condition": "ctrl",
             "date": "d1", "position_id": "p0", "cell_id": 1,
             "frame": float(i), "area": float(i)}
            for i in range(compiler.geoms_mod.POINT_CAP + 5)]
    table = {"schema": SCHEMA, "rows": rows}
    r = client.post("/analyze", json={"table": table,
                                      "spec": make_spec(geoms=("line",))})
    assert r.status_code == 422
    assert "too many to draw" in r.json()["detail"]
