"""Plot-area size (item E, reworked): `plot_w_mm`/`plot_h_mm` pin the axes box
to a size in mm inside the (independently sized) canvas. Nothing stores a
position: after constrained layout solves, _place_plot sits the box where its
tick and axis labels fit (PLOT_PAD_MM off the canvas's left and bottom edge) and
leaves the rest of the canvas free to the right and above. The legacy
`axes_rect` of older documents counts for its size only."""
import matplotlib
matplotlib.use("Agg")
import pandas as pd
import pytest

from iris_engine import compiler

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "x", "type": "numeric", "label": "X"},
    {"name": "y", "type": "numeric", "label": "Y"},
    {"name": "grp", "type": "categorical", "label": "Group", "levels": ["a", "b"]},
]}
DF = pd.DataFrame({
    "id": [f"r{i}" for i in range(6)],
    "x": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
    "y": [2.0, 1.0, 4.0, 3.0, 6.0, 5.0],
    "grp": ["a", "a", "a", "b", "b", "b"],
})
RESULT = {"result": {}}


def _scatter_spec(overrides):
    e = {k: None for k in ("x", "y", "color", "size", "shape")}
    e["x"] = {"column": "x"}
    e["y"] = {"column": "y"}
    return {"encodings": e, "layers": [{"geom": "scatter", "params": {}}],
            "style": {"overrides": overrides}}


def _mm(fig):
    """(axes size, axes left/bottom, label overhang left/bottom) in mm"""
    ax = fig.axes[0]
    pos = ax.get_position()
    w_mm, h_mm = fig.get_size_inches() * 25.4
    r = fig.canvas.get_renderer()
    box, tight = ax.get_window_extent(r), ax.get_tightbbox(r)
    px = compiler.MM * fig.dpi
    return ((pos.width * w_mm, pos.height * h_mm), (pos.x0 * w_mm, pos.y0 * h_mm),
            ((box.x0 - tight.x0) / px, (box.y0 - tight.y0) / px))


def test_plot_size_pins_the_axes_box_and_derives_its_place():
    fig = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({"plot_w_mm": 60, "plot_h_mm": 40}), RESULT)
    compiler.figure_to_svg(fig)  # triggers _finalize_deferred → _place_plot + freeze
    size, (left, bottom), (over_l, over_b) = _mm(fig)
    assert size == pytest.approx((60, 40), abs=0.05)
    # the labels fit: the box sits their overhang plus the pad from the edge
    assert left == pytest.approx(over_l + compiler.PLOT_PAD_MM, abs=0.05)
    assert bottom == pytest.approx(over_b + compiler.PLOT_PAD_MM, abs=0.05)
    assert over_l > 3 and over_b > 3          # tick labels + axis label
    compiler.close(fig)


def test_one_dimension_keeps_the_layouts_other():
    auto = compiler.build_scatter_figure(DF, SCHEMA, _scatter_spec({}), RESULT)
    compiler.figure_to_svg(auto)
    fig = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({"plot_w_mm": 60}), RESULT)
    compiler.figure_to_svg(fig)
    assert _mm(fig)[0][0] == pytest.approx(60, abs=0.05)
    assert _mm(fig)[0][1] == pytest.approx(_mm(auto)[0][1], abs=0.05)
    compiler.close(fig)
    compiler.close(auto)


def test_legacy_axes_rect_counts_for_its_size_only():
    """An old document's pinned rect keeps the plot the size it was; where it
    sat is no longer stored, the box goes where its labels fit."""
    fig = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({"axes_rect": [0.3, 0.3, 0.5, 0.6]}), RESULT)
    compiler.figure_to_svg(fig)
    size, (left, bottom), (over_l, over_b) = _mm(fig)
    assert size == pytest.approx((0.5 * 140, 0.6 * 100), abs=0.05)
    assert left == pytest.approx(over_l + compiler.PLOT_PAD_MM, abs=0.05)
    assert left < 0.3 * 140 - 10
    compiler.close(fig)


def test_a_size_the_canvas_cannot_hold_clips_the_bottom_labels_not_the_plot():
    """140 × 100 canvas, a 90 mm tall plot with a title: the box and the title
    stay inside the canvas, the x labels are what hangs off the bottom."""
    fig = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({"plot_h_mm": 90, "title": "Tall"}), RESULT)
    compiler.figure_to_svg(fig)
    size, (left, bottom), (over_l, over_b) = _mm(fig)
    assert size[1] == pytest.approx(90, abs=0.05)
    r = fig.canvas.get_renderer()
    tight = fig.axes[0].get_tightbbox(r)
    assert tight.y1 <= fig.bbox.y1 + 0.5          # title inside
    assert tight.y0 < fig.bbox.y0 - 1             # labels clipped below
    assert bottom < over_b                        # (not given their room)
    compiler.close(fig)


def test_no_plot_size_leaves_constrained_layout():
    """Without a pin the plot area is whatever constrained layout chose — in
    particular not the 60 × 40 of the test above, so the pin is opt-in."""
    fig = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({}), RESULT)
    compiler.figure_to_svg(fig)
    assert _mm(fig)[0][0] > 100
    assert fig.axes[0].get_in_layout()
    compiler.close(fig)


def test_plot_size_idempotent_second_save():
    """A second save must not move the axes again (the stash is popped once)."""
    fig = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({"plot_w_mm": 70, "plot_h_mm": 70}), RESULT)
    compiler.figure_to_svg(fig)
    first = fig.axes[0].get_position()
    compiler.figure_to_svg(fig)
    second = fig.axes[0].get_position()
    assert first.bounds == pytest.approx(second.bounds, abs=1e-6)
    compiler.close(fig)
