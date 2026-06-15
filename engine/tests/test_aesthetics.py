"""Phase 2 aesthetics: color/size/shape draw on scatter (per-point) and on the
group geoms (dodged), and the click-to-exclude point-group contract survives
sub-series splitting."""
import matplotlib
matplotlib.use("Agg")
import pandas as pd
import pytest

from triad_engine import compiler, scales

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "x", "type": "numeric", "label": "X"},
    {"name": "y", "type": "numeric", "label": "Y"},
    {"name": "grp", "type": "categorical", "label": "Group", "levels": ["a", "b"]},
    {"name": "w", "type": "numeric", "label": "Weight"},
]}
DF = pd.DataFrame({
    "id": [f"r{i}" for i in range(6)],
    "x": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
    "y": [2.0, 1.0, 4.0, 3.0, 6.0, 5.0],
    "grp": ["a", "a", "a", "b", "b", "b"],
    "w": [1.0, 2.0, 3.0, 4.0, 5.0, 9.0],
})
RESULT = {"result": {}}  # no regression / annotation


def _scatter_spec(**enc):
    e = {k: None for k in ("x", "y", "color", "size", "shape")}
    e["x"] = {"column": "x"}
    e["y"] = {"column": "y"}
    e.update({k: {"column": v} for k, v in enc.items()})
    return {"encodings": e, "layers": [{"geom": "scatter", "params": {}}],
            "style": {"preset": "demo_default", "overrides": {}}}


def _partition_ok(point_groups, df):
    rows = sorted(r for g in point_groups for r in g["row_ids"])
    assert rows == sorted(df["id"].tolist())          # covers every row once
    gids = [g["gid"] for g in point_groups]
    assert len(gids) == len(set(gids))                # unique gids


def test_scatter_no_channels_is_single_series():
    _, pg = compiler.build_scatter_figure(DF, SCHEMA, _scatter_spec(), RESULT)
    assert pg == [{"gid": "pts-0", "row_ids": DF["id"].tolist()}]


def test_scatter_color_splits_into_per_level_series():
    _, pg = compiler.build_scatter_figure(DF, SCHEMA,
                                          _scatter_spec(color="grp"), RESULT)
    assert len(pg) == 2                               # one series per color level
    _partition_ok(pg, DF)
    by_first = {g["row_ids"][0] for g in pg}
    assert by_first == {"r0", "r3"}                   # a-rows and b-rows split


def test_scatter_shape_splits_into_per_level_series():
    _, pg = compiler.build_scatter_figure(DF, SCHEMA,
                                          _scatter_spec(shape="grp"), RESULT)
    assert len(pg) == 2
    _partition_ok(pg, DF)


# ---------------- dodged group geoms (color = a second factor) ----------------

CMP_SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "cond", "type": "categorical", "label": "Condition",
     "levels": ["ctrl", "drug"]},
    {"name": "geno", "type": "categorical", "label": "Genotype",
     "levels": ["wt", "ko"]},
    {"name": "resp", "type": "numeric", "label": "Response"},
]}


def _cmp_df():
    rows, rid = [], 0
    for cond in ("ctrl", "drug"):
        for geno in ("wt", "ko"):
            for v in (1.0, 2.0, 3.0, 4.0):
                rows.append({"id": f"r{rid}", "cond": cond, "geno": geno,
                             "resp": v + (0 if cond == "ctrl" else 2)})
                rid += 1
    return pd.DataFrame(rows)


def _cmp_spec(geom, **enc):
    e = {k: None for k in ("x", "y", "color", "size", "shape")}
    e["x"] = {"column": "cond"}
    e["y"] = {"column": "resp"}
    e.update({k: {"column": v} for k, v in enc.items()})
    return {"encodings": e, "layers": [{"geom": geom, "params": {}}],
            "stat_model": {"family": "group_comparison"},
            "style": {"preset": "demo_default", "overrides": {}}}


def _cmp_stats():
    # describe-only shaped result: summaries per x-level, no p (no bracket)
    return {"levels": ["ctrl", "drug"],
            "summaries": [{"group": "ctrl", "n": 8, "mean": 2.5, "sd": 1.0,
                           "ci95_half": 0.5},
                          {"group": "drug", "n": 8, "mean": 4.5, "sd": 1.0,
                           "ci95_half": 0.5}],
            "result": {}, "alpha": 0.05}


def test_color_second_factor_builds_dodged_cells():
    df = _cmp_df()
    ctx = compiler._comparison_context(
        df, CMP_SCHEMA, _cmp_spec("box", color="geno"), _cmp_stats())
    assert ctx["dodged"] is True
    assert len(ctx["groups"]) == 4               # 2 conditions × 2 genotypes
    # within an x-level the two genotype cells sit at offset, mirrored positions
    by_lv = {}
    for g in ctx["groups"]:
        by_lv.setdefault(g["lv"], []).append(g["pos"])
    for lv, positions in by_lv.items():
        center = ["ctrl", "drug"].index(lv)
        assert len(positions) == 2
        assert min(positions) < center < max(positions)   # dodged around tick
    # cell colors come from the color scale, not the x-group palette
    colors = {g["color"] for g in ctx["groups"]}
    assert len(colors) == 2                       # one per genotype, not per cell


def test_color_equal_to_x_is_not_dodged():
    df = _cmp_df()
    spec = _cmp_spec("dot", color="cond")        # color == x → today's behaviour
    ctx = compiler._comparison_context(df, CMP_SCHEMA, spec, _cmp_stats())
    assert ctx["dodged"] is False
    assert len(ctx["groups"]) == 2               # one cell per x-level
    _, pg = compiler.build_comparison_figure(df, CMP_SCHEMA, spec, _cmp_stats())
    assert len(pg) == 2                           # one dot series per x-level


def test_dodged_dots_split_points_per_cell():
    df = _cmp_df()
    _, pg = compiler.build_comparison_figure(
        df, CMP_SCHEMA, _cmp_spec("dot", color="geno"), _cmp_stats())
    assert len(pg) == 4                          # cond × geno cells
    rows = sorted(r for g in pg for r in g["row_ids"])
    assert rows == sorted(df["id"].tolist())     # every row drawn once


def test_scatter_size_varies_marker_area_within_range():
    fig, pg = compiler.build_scatter_figure(DF, SCHEMA,
                                            _scatter_spec(size="w"), RESULT)
    assert len(pg) == 1                               # size alone: one series
    ax = fig.axes[0]
    sizes = ax.collections[0].get_sizes()
    assert len(set(sizes.round(3))) > 1               # areas actually vary
    assert sizes.min() == pytest.approx(scales.SIZE_MIN_AREA)
    assert sizes.max() == pytest.approx(scales.SIZE_MAX_AREA)
