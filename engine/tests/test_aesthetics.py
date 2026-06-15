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


def test_scatter_size_varies_marker_area_within_range():
    fig, pg = compiler.build_scatter_figure(DF, SCHEMA,
                                            _scatter_spec(size="w"), RESULT)
    assert len(pg) == 1                               # size alone: one series
    ax = fig.axes[0]
    sizes = ax.collections[0].get_sizes()
    assert len(set(sizes.round(3))) > 1               # areas actually vary
    assert sizes.min() == pytest.approx(scales.SIZE_MIN_AREA)
    assert sizes.max() == pytest.approx(scales.SIZE_MAX_AREA)
