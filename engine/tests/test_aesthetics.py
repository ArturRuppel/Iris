"""Phase 2 aesthetics: color/size/shape draw on scatter (per-point) and on the
group geoms (dodged). Item I removed the click-to-select point-group contract,
so colour is now vectorized into one scatter call per marker (a discrete colour
no longer splits into per-level series); only a mapped shape still splits."""
import matplotlib
matplotlib.use("Agg")
from matplotlib.collections import PathCollection
import pandas as pd
import pytest

from iris_engine import compiler, scales


def _scatter_colls(ax):
    """The scatter PathCollections on an axes (excludes fill_between PolyCollections
    and the like), in draw order."""
    return [c for c in ax.collections if isinstance(c, PathCollection)]


def _total_points(ax):
    return sum(len(c.get_offsets()) for c in _scatter_colls(ax))

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


def test_scatter_no_channels_is_single_collection():
    fig = compiler.build_scatter_figure(DF, SCHEMA, _scatter_spec(), RESULT)
    colls = _scatter_colls(fig.axes[0])
    assert len(colls) == 1                            # one uniform scatter call
    assert len(colls[0].get_offsets()) == len(DF)     # every row drawn once
    compiler.close(fig)


def test_scatter_discrete_color_is_one_vectorized_collection():
    # Item I: a discrete colour is no longer split into per-level series; it draws
    # in a single scatter call carrying a per-point colour array.
    fig = compiler.build_scatter_figure(DF, SCHEMA,
                                        _scatter_spec(color="grp"), RESULT)
    colls = _scatter_colls(fig.axes[0])
    assert len(colls) == 1
    fc = colls[0].get_facecolors()
    assert len(fc) == len(DF)                         # one colour per point
    assert len({tuple(c) for c in fc}) == 2           # two distinct group colours
    compiler.close(fig)


def test_scatter_shape_splits_into_per_marker_series():
    # a mapped shape still splits (matplotlib can't vary the marker per point)
    fig = compiler.build_scatter_figure(DF, SCHEMA,
                                        _scatter_spec(shape="grp"), RESULT)
    assert len(_scatter_colls(fig.axes[0])) == 2
    assert _total_points(fig.axes[0]) == len(DF)      # every row drawn once
    compiler.close(fig)


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


def _cmp_ctx(df, schema, spec):
    """Redesign: the per-x-level/colour groups now come from `_groups` over a
    level table (here the raw frame) on top of the shared `_layout`."""
    layout = compiler._layout(df, schema, spec)
    layout["groups"] = compiler._groups(df, layout)
    return layout


def test_color_second_factor_builds_dodged_cells():
    df = _cmp_df()
    ctx = _cmp_ctx(df, CMP_SCHEMA, _cmp_spec("box", color="geno"))
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


ID_SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "cond", "type": "categorical", "label": "Condition",
     "levels": ["ctrl", "drug"]},
    {"name": "batch", "type": "identifier", "label": "Batch"},   # a replicate id
    {"name": "resp", "type": "numeric", "label": "Response"},
]}


def _id_df():
    rows, rid = [], 0
    for cond in ("ctrl", "drug"):
        for batch in ("b1", "b2"):
            for v in (1.0, 2.0, 3.0, 4.0):
                rows.append({"id": f"r{rid}", "cond": cond, "batch": batch,
                             "resp": v})
                rid += 1
    return pd.DataFrame(rows)


def test_identifier_color_dodges_a_box_with_no_point_layer():
    """A box on its own coloured by an identifier (e.g. `date`) has no per-point
    layer to claim the id for superplot replicate colouring, so it dodges each x
    group into one box per id — the grouped-boxplot the user expects."""
    spec = _cmp_spec("box", color="batch")
    spec["encodings"]["x"] = {"column": "cond"}
    ctx = _cmp_ctx(_id_df(), ID_SCHEMA, spec)
    assert ctx["dodged"] is True
    assert len(ctx["groups"]) == 4               # 2 conditions × 2 batches


def test_identifier_color_does_not_dodge_when_a_point_layer_is_present():
    """Adding a dot layer reclaims the identifier colour for the superplot idiom
    (per-row colouring, one uniform box per x-level) — no dodge."""
    spec = _cmp_spec("box", color="batch")
    spec["encodings"]["x"] = {"column": "cond"}
    spec["layers"].append({"geom": "dot", "params": {}})
    ctx = _cmp_ctx(_id_df(), ID_SCHEMA, spec)
    assert ctx["dodged"] is False
    assert len(ctx["groups"]) == 2               # one cell per x-level


def test_color_equal_to_x_is_not_dodged():
    df = _cmp_df()
    spec = _cmp_spec("dot", color="cond")        # color == x → today's behaviour
    ctx = _cmp_ctx(df, CMP_SCHEMA, spec)
    assert ctx["dodged"] is False
    assert len(ctx["groups"]) == 2               # one cell per x-level
    fig = compiler.build_comparison_figure(df, CMP_SCHEMA, spec, _cmp_stats())
    assert len(_scatter_colls(fig.axes[0])) == 2  # one dot series per x-level
    compiler.close(fig)


def test_dodged_dots_split_points_per_cell():
    df = _cmp_df()
    fig = compiler.build_comparison_figure(
        df, CMP_SCHEMA, _cmp_spec("dot", color="geno"), _cmp_stats())
    colls = _scatter_colls(fig.axes[0])
    assert len(colls) == 4                       # cond × geno cells
    assert _total_points(fig.axes[0]) == len(df)  # every row drawn once
    compiler.close(fig)


def test_scatter_size_varies_marker_area_within_range():
    fig = compiler.build_scatter_figure(DF, SCHEMA,
                                        _scatter_spec(size="w"), RESULT)
    ax = fig.axes[0]
    assert len(_scatter_colls(ax)) == 1               # size alone: one series
    sizes = ax.collections[0].get_sizes()
    assert len(set(sizes.round(3))) > 1               # areas actually vary
    assert sizes.min() == pytest.approx(scales.SIZE_MIN_AREA)
    assert sizes.max() == pytest.approx(scales.SIZE_MAX_AREA)


# ---------------- legend ----------------

def test_color_scatter_draws_legend_with_level_labels():
    fig = compiler.build_scatter_figure(DF, SCHEMA,
                                           _scatter_spec(color="grp"), RESULT)
    leg = fig.axes[0].get_legend()
    assert leg is not None
    assert leg.get_gid() == "legend"
    labels = {t.get_text() for t in leg.get_texts()}
    assert {"a", "b"} <= labels                       # one entry per color level


def test_color_and_shape_on_same_column_make_one_merged_legend():
    # Item J: mapping the same column to color AND shape used to draw two
    # redundant legend blocks (a, b, a, b). They now collapse to one block: a
    # single title and one row per label whose handle carries both attributes.
    fig = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec(color="grp", shape="grp"), RESULT)
    leg = fig.axes[0].get_legend()
    assert leg is not None
    # exactly one row per level — not duplicated across two blocks
    assert [t.get_text() for t in leg.get_texts()] == ["a", "b"]
    assert leg.get_title().get_text() == "grp"        # single titled block
    # each handle shows both the color (from the palette) and a non-default marker
    handles = leg.legend_handles
    assert len(handles) == 2
    assert handles[0].get_marker() == scales.MARKERS[0]
    assert handles[1].get_marker() == scales.MARKERS[1]
    compiler.close(fig)


def _legend_marker_xy(svg):
    """Display position of the legend's first drawn element in the rendered SVG,
    so we can tell whether the legend moved. With svg.fonttype=none the first
    positioned element is the legend title <text>, which carries x/y attributes
    (not a translate) — read those."""
    import re
    i = svg.find('id="legend"')
    assert i != -1, "no legend group in SVG"
    m = re.search(r'x="([0-9.]+)" y="([0-9.]+)"', svg[i:])
    assert m, "no positioned element in legend group"
    return float(m.group(1)), float(m.group(2))


def test_legend_offset_moves_the_drawn_legend():
    # dragging the legend writes offsets['legend'] (SVG px, y down); the engine
    # must re-anchor the *drawn* legend by that delta, not just tag it.
    base_spec = _scatter_spec(color="grp")
    fig0 = compiler.build_scatter_figure(DF, SCHEMA, base_spec, RESULT)
    x0, y0 = _legend_marker_xy(compiler.figure_to_svg(fig0))

    spec = _scatter_spec(color="grp")
    spec["style"]["overrides"]["offsets"] = {"legend": [40, 20]}
    fig1 = compiler.build_scatter_figure(DF, SCHEMA, spec, RESULT)
    x1, y1 = _legend_marker_xy(compiler.figure_to_svg(fig1))

    # +x moves right, +y (SVG down) moves down → larger SVG y
    assert x1 > x0 + 20 and y1 > y0 + 10


def test_legend_offset_idempotent_across_saves():
    # a second save (e.g. SVG then PNG export) must not double-apply the nudge
    spec = _scatter_spec(color="grp")
    spec["style"]["overrides"]["offsets"] = {"legend": [40, 20]}
    fig = compiler.build_scatter_figure(DF, SCHEMA, spec, RESULT)
    first = _legend_marker_xy(compiler.figure_to_svg(fig))
    second = _legend_marker_xy(compiler.figure_to_svg(fig))
    assert first == pytest.approx(second)


def test_no_channels_draws_no_legend():
    fig = compiler.build_scatter_figure(DF, SCHEMA, _scatter_spec(), RESULT)
    assert fig.axes[0].get_legend() is None


def test_show_legend_false_suppresses_it():
    spec = _scatter_spec(color="grp")
    spec["style"]["overrides"]["show_legend"] = False
    fig = compiler.build_scatter_figure(DF, SCHEMA, spec, RESULT)
    assert fig.axes[0].get_legend() is None


# ---------------- continuous color (Phase 3b) ----------------

def test_scatter_numeric_color_is_single_series_with_colorbar():
    fig = compiler.build_scatter_figure(DF, SCHEMA,
                                        _scatter_spec(color="w"), RESULT)
    # a numeric color is one vectorized scatter call, not discrete level series
    assert len(_scatter_colls(fig.axes[0])) == 1
    # the scatter carries a per-point value array, and a colorbar adds an Axes
    arr = fig.axes[0].collections[0].get_array()
    assert arr is not None and len(arr) == len(DF)
    assert len(fig.axes) == 2                          # main + colorbar
    assert fig.axes[0].get_legend() is None            # no swatch legend


def test_scatter_numeric_color_show_legend_false_hides_colorbar():
    spec = _scatter_spec(color="w")
    spec["style"]["overrides"]["show_legend"] = False
    fig = compiler.build_scatter_figure(DF, SCHEMA, spec, RESULT)
    assert len(fig.axes) == 1                          # colorbar suppressed


def _num_color_cmp():
    schema = {"schema_version": "1.0", "columns": [
        {"name": "cond", "type": "categorical", "label": "Condition",
         "levels": ["ctrl", "drug"]},
        {"name": "age", "type": "numeric", "label": "Age"},
        {"name": "resp", "type": "numeric", "label": "Response"}]}
    rows, rid = [], 0
    for cond in ("ctrl", "drug"):
        for v in (1.0, 2.0, 3.0, 4.0):
            rows.append({"id": f"r{rid}", "cond": cond, "age": float(v),
                         "resp": v + (0 if cond == "ctrl" else 2)})
            rid += 1
    return pd.DataFrame(rows), schema


def test_comparison_dots_numeric_color_per_point_not_dodged():
    df, schema = _num_color_cmp()
    spec = _cmp_spec("dot", color="age")               # numeric color in a group cmp
    ctx = _cmp_ctx(df, schema, spec)
    assert ctx["dodged"] is False                      # numeric color never dodges
    assert ctx["scales"].color_numeric is True
    fig = compiler.build_comparison_figure(df, schema, spec, _cmp_stats())
    assert len(_scatter_colls(fig.axes[0])) == 2        # one dot series per x-level
    assert len(fig.axes) == 2                           # colorbar present


def test_show_n_toggles_per_group_n_labels():
    # the style flag is the only thing that gates the `n = N` labels; the count
    # is the raw observations per x-level (8 per condition in _cmp_df).
    def n_labels(show_n):
        spec = _cmp_spec("dot")
        spec["style"]["overrides"] = {"show_n": show_n}
        fig = compiler.build_comparison_figure(
            _cmp_df(), CMP_SCHEMA, spec, _cmp_stats())
        return [t.get_text() for ax in fig.axes for t in ax.texts
                if t.get_text().startswith("n =")]

    assert n_labels(True) == ["n = 8", "n = 8"]
    assert n_labels(False) == []


def test_dodged_comparison_draws_legend_but_color_equals_x_does_not():
    df = _cmp_df()
    fig = compiler.build_comparison_figure(
        df, CMP_SCHEMA, _cmp_spec("box", color="geno"), _cmp_stats())
    assert fig.axes[0].get_legend() is not None       # second factor → legend

    fig2 = compiler.build_comparison_figure(
        df, CMP_SCHEMA, _cmp_spec("dot", color="cond"), _cmp_stats())
    assert fig2.axes[0].get_legend() is None          # color == x → no legend


# ---------------------------------------------------------------------------
# Item P — grouped distribution / "potential" curves (color overlay, shared
# bins, the ΔE barrier annotation).
# ---------------------------------------------------------------------------
import numpy as np

DIST_SCHEMA = {"columns": [
    {"name": "coord", "type": "numeric", "label": "Coord"},
    {"name": "grp", "type": "categorical", "label": "Group", "levels": ["a", "b"]},
]}


def _dist_df(*, positive=False):
    rng = np.random.default_rng(0)
    base = 6.0 if positive else 0.0   # shift wholly positive to un-bracket x=0
    def well(n):
        return np.concatenate([rng.normal(base - 2, 0.5, n),
                               rng.normal(base + 2, 0.5, n)])
    return pd.DataFrame({"coord": np.concatenate([well(40), well(40)]),
                         "grp": ["a"] * 80 + ["b"] * 80})


def _dist_spec(geom_overrides, *, color=True, fig_overrides=None, facet=None):
    enc = {"x": None, "y": {"column": "coord"},
           "color": {"column": "grp"} if color else None,
           "size": None, "shape": None}
    ov = {"geoms": {"distribution": dict(geom_overrides)}}
    if fig_overrides:
        ov.update(fig_overrides)
    spec = {"encodings": enc, "layers": [{"geom": "distribution", "level": ""}],
            "style": {"overrides": ov}}
    if facet:
        spec["facet"] = facet
    return spec


def _hist_stats():
    return {"alpha": 0.05, "result": {}}


def test_grouped_potential_one_curve_per_level_on_shared_bins():
    df = _dist_df()
    spec = _dist_spec({"dist_render": "potential", "bin_method": "sinh"})
    fig = compiler.build_histogram_figure(df, DIST_SCHEMA, spec, _hist_stats())
    ax = fig.axes[0]
    assert len(fig.axes) == 1                              # one overlaid panel
    assert len(ax.lines) == 2                              # one curve per group
    # both curves are histogrammed over the SAME shared edges (pooled values)
    gs = {"dist_render": "potential", "bin_method": "sinh"}
    edges = compiler._shared_dist_bins(gs, df["coord"].to_numpy(float))
    centers = set(np.round((edges[:-1] + edges[1:]) / 2, 9))
    for line in ax.lines:
        assert set(np.round(line.get_xdata(), 9)) <= centers
    compiler.close(fig)


def test_grouped_distribution_draws_a_legend():
    fig = compiler.build_histogram_figure(
        _dist_df(), DIST_SCHEMA, _dist_spec({"dist_render": "bars"}), _hist_stats())
    assert fig.axes[0].get_legend() is not None
    compiler.close(fig)


def test_barrier_label_per_group_when_show_barrier_on():
    df = _dist_df()
    over = {"dist_render": "potential", "bin_method": "sinh", "show_barrier": True}
    fig = compiler.build_histogram_figure(
        df, DIST_SCHEMA, _dist_spec(over), _hist_stats())
    labels = [t.get_text() for ax in fig.axes for t in ax.texts
              if t.get_text().startswith("ΔE")]
    assert len(labels) == 2                               # one per group
    compiler.close(fig)

    # off by default → no barrier label
    fig2 = compiler.build_histogram_figure(
        df, DIST_SCHEMA,
        _dist_spec({"dist_render": "potential", "bin_method": "sinh"}), _hist_stats())
    assert not [t for ax in fig2.axes for t in ax.texts
                if t.get_text().startswith("ΔE")]
    compiler.close(fig2)


def test_barrier_skipped_when_reference_not_bracketed():
    # all values positive → reference 0 is left of every occupied bin → no ΔE
    df = _dist_df(positive=True)
    over = {"dist_render": "potential", "bin_method": "sinh", "show_barrier": True}
    fig = compiler.build_histogram_figure(
        df, DIST_SCHEMA, _dist_spec(over), _hist_stats())
    assert not [t for ax in fig.axes for t in ax.texts
                if t.get_text().startswith("ΔE")]
    compiler.close(fig)


def test_shared_sinh_bins_are_symmetric_about_zero():
    vals = np.array([-3.0, -1.0, 0.5, 2.0, 7.0])   # asymmetric pooled range
    edges = compiler._shared_dist_bins(
        {"bin_method": "sinh", "hist_bins": 10}, vals)
    assert edges[0] == pytest.approx(-edges[-1])    # symmetric span [-m, m]
    assert edges[-1] == pytest.approx(7.0)          # m = max|value|


def test_faceted_distribution_shares_bins_across_cells():
    # two facet cells (by grp), no color overlay; both cells bin over pooled edges
    df = _dist_df()
    spec = _dist_spec({"dist_render": "potential", "bin_method": "sinh"},
                      color=False, fig_overrides={"show_annotation": False},
                      facet={"row": None, "col": {"column": "grp"},
                             "share_x": True, "share_y": True})
    fig = compiler.build_histogram_figure(df, DIST_SCHEMA, spec, _hist_stats())
    assert len(fig.axes) == 2
    gs = {"dist_render": "potential", "bin_method": "sinh"}
    edges = compiler._shared_dist_bins(gs, df["coord"].to_numpy(float))
    centers = set(np.round((edges[:-1] + edges[1:]) / 2, 9))
    for ax in fig.axes:
        for line in ax.lines:
            assert set(np.round(line.get_xdata(), 9)) <= centers
    compiler.close(fig)
