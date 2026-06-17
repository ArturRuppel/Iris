"""Plot-area drag/resize (item E): the `axes_rect` style override pins the axes
to an explicit figure-fraction rectangle inside the (independently sized) canvas,
so a grown canvas can host a docked legend in the freed space. The override is
applied in _finalize_deferred after constrained layout solves, then frozen."""
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


def test_axes_rect_pins_plot_area():
    box = [0.1, 0.2, 0.5, 0.6]  # left, bottom, width, height in figure fractions
    fig, _ = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({"axes_rect": box}), RESULT)
    compiler.figure_to_svg(fig)  # triggers _finalize_deferred → set_position + freeze
    pos = fig.axes[0].get_position()
    assert pos.x0 == pytest.approx(0.1, abs=1e-3)
    assert pos.y0 == pytest.approx(0.2, abs=1e-3)
    assert pos.width == pytest.approx(0.5, abs=1e-3)
    assert pos.height == pytest.approx(0.6, abs=1e-3)
    compiler.close(fig)


def test_no_axes_rect_leaves_constrained_layout():
    """Without the override the plot area is whatever constrained layout chose —
    in particular not the test rect above, so the pin is opt-in."""
    fig, _ = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({}), RESULT)
    compiler.figure_to_svg(fig)
    pos = fig.axes[0].get_position()
    assert not (pos.x0 == pytest.approx(0.1, abs=1e-3)
                and pos.width == pytest.approx(0.5, abs=1e-3))
    compiler.close(fig)


def test_axes_rect_idempotent_second_save():
    """A second save must not move the axes again (the stash is popped once)."""
    box = [0.15, 0.15, 0.7, 0.7]
    fig, _ = compiler.build_scatter_figure(
        DF, SCHEMA, _scatter_spec({"axes_rect": box}), RESULT)
    compiler.figure_to_svg(fig)
    first = fig.axes[0].get_position()
    compiler.figure_to_svg(fig)
    second = fig.axes[0].get_position()
    assert first.bounds == pytest.approx(second.bounds, abs=1e-6)
    compiler.close(fig)
