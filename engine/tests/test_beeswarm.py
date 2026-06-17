"""Beeswarm (`layout="swarm"`) for the dot geom: a dense group packs into a
no-overlap swarm at final draw, building a violin-like silhouette while keeping
every raw mark intact (the solver never adds or drops points). Jitter stays
available as a selectable layout."""
import matplotlib
matplotlib.use("Agg")
from matplotlib.collections import PathCollection
import numpy as np
import pandas as pd

from iris_engine import compiler

SWARM_SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "cond", "type": "categorical", "label": "Condition",
     "levels": ["ctrl"]},
    {"name": "resp", "type": "numeric", "label": "Response"},
]}


def _df(values):
    return pd.DataFrame({"id": [f"r{i}" for i in range(len(values))],
                         "cond": ["ctrl"] * len(values),
                         "resp": [float(v) for v in values]})


def _spec(layout, horizontal=False):
    x, y = ("resp", "cond") if horizontal else ("cond", "resp")
    e = {k: None for k in ("x", "y", "color", "size", "shape")}
    e["x"] = {"column": x}
    e["y"] = {"column": y}
    return {"encodings": e,
            "layers": [{"geom": "dot", "params": {"layout": layout}}],
            "stat_model": {"family": "group_comparison"},
            "style": {"preset": "demo_default", "overrides": {}}}


def _stats():
    return {"levels": ["ctrl"], "result": {}, "alpha": 0.05,
            "summaries": [{"group": "ctrl", "n": 1, "mean": 0.0, "sd": 1.0,
                           "ci95_half": 0.5}]}


def _dots(fig):
    """Every dot PathCollection on the axes (dots draw as plain scatter calls)."""
    return [c for ax in fig.axes for c in ax.collections
            if isinstance(c, PathCollection)]


# --- swarm spreads a dense lane -------------------------------------------

def test_swarm_packs_dense_lane_into_distinct_coordinates():
    # 30 points at the same value must overlap if stacked — the solver spreads
    # them along the categorical (x) axis at final draw.
    fig = compiler.build_comparison_figure(
        _df([5.0] * 30), SWARM_SCHEMA, _spec("swarm"), _stats())
    colls = _dots(fig)
    pre = np.concatenate([c.get_offsets() for c in colls])
    assert np.allclose(pre[:, 0], 0.0)                 # drawn at lane centre

    # the lane was registered for the deferred solve
    assert getattr(fig, "_iris_beeswarm", None)

    compiler.figure_to_svg(fig)                         # triggers _apply_beeswarm
    post = np.concatenate([c.get_offsets() for c in colls])

    xs = post[:, 0]
    assert np.ptp(xs) > 0.1                             # genuinely spread out
    assert np.all(np.abs(xs) <= 0.4 + 1e-9)            # within ±0.4 * wscale
    assert np.allclose(post[:, 1], 5.0)               # value axis untouched
    # the stash is consumed (idempotent on a second save)
    assert not getattr(fig, "_iris_beeswarm", None)


def test_swarm_preserves_point_count():
    df = _df([5.0] * 24)
    fig = compiler.build_comparison_figure(
        df, SWARM_SCHEMA, _spec("swarm"), _stats())
    colls = _dots(fig)
    counts_pre = [len(c.get_offsets()) for c in colls]

    compiler.figure_to_svg(fig)
    counts_post = [len(c.get_offsets()) for c in colls]

    assert counts_pre == counts_post                  # solver never adds/drops
    assert sum(counts_post) == len(df)                # every row drawn once


def test_swarm_builds_a_peaked_silhouette():
    # symmetric, peaked at resp=5 → the swarm is widest there, like a violin.
    counts = {3: 5, 4: 10, 5: 30, 6: 10, 7: 5}
    vals = [v for v, c in counts.items() for _ in range(c)]
    fig = compiler.build_comparison_figure(
        _df(vals), SWARM_SCHEMA, _spec("swarm"), _stats())
    colls = _dots(fig)
    compiler.figure_to_svg(fig)
    off = np.concatenate([c.get_offsets() for c in colls])

    def width_at(v):
        return np.ptp(off[np.isclose(off[:, 1], v), 0])

    assert width_at(5) > width_at(3)                  # dense centre spreads wider
    assert width_at(5) > width_at(7)


# --- horizontal orientation -----------------------------------------------

def test_swarm_horizontal_packs_along_the_y_axis():
    fig = compiler.build_comparison_figure(
        _df([5.0] * 30), SWARM_SCHEMA, _spec("swarm", horizontal=True), _stats())
    rec = fig._iris_beeswarm[0]
    assert rec["orient"] == "y"
    colls = _dots(fig)
    compiler.figure_to_svg(fig)
    off = np.concatenate([c.get_offsets() for c in colls])
    assert np.ptp(off[:, 1]) > 0.1                    # categorical (y) spread
    assert np.allclose(off[:, 0], 5.0)               # value runs along x


# --- jitter stays available and unchanged ---------------------------------

def test_jitter_layout_uses_stable_hash_offsets_and_no_solve():
    df = _df([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
    fig = compiler.build_comparison_figure(
        df, SWARM_SCHEMA, _spec("jitter"), _stats())
    assert not getattr(fig, "_iris_beeswarm", None)   # jitter registers no lane
    coll = _dots(fig)[0]
    xs = coll.get_offsets()[:, 0]
    # single ungrouped series at pos 0, wscale 1 → offset is the stable hash
    expected = [compiler._stable_jitter(rid, 0.18) for rid in df["id"]]
    assert np.allclose(xs, expected)


def test_default_dot_layout_is_swarm():
    # a layer with no explicit layout param takes the swarm default
    spec = _spec("swarm")
    spec["layers"][0]["params"] = {}
    fig = compiler.build_comparison_figure(
        _df([5.0] * 12), SWARM_SCHEMA, spec, _stats())
    assert getattr(fig, "_iris_beeswarm", None)
