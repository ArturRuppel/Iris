"""Aesthetic scale resolution: encodings + data -> color/size/shape lookups."""
import numpy as np
import pandas as pd

from triad_engine import scales

PAL = ["#111111", "#222222", "#333333"]
STYLE = {"palette": PAL}
SCHEMA = {
    "columns": [
        {"name": "cond", "type": "categorical", "levels": ["wt", "ko"]},
        {"name": "geno", "type": "categorical"},  # no declared levels
        {"name": "dose", "type": "numeric"},
        {"name": "y", "type": "numeric"},
    ]
}
DF = pd.DataFrame({
    "cond": ["wt", "ko", "wt", "ko"],
    "geno": ["b", "a", "a", "b"],
    "dose": [0.0, 5.0, 10.0, 5.0],
    "y": [1.0, 2.0, 3.0, 4.0],
})


def _enc(**kw):
    base = {k: None for k in ("x", "y", "color", "size", "shape")}
    base.update({k: {"column": v} for k, v in kw.items()})
    return base


def test_categorical_color_assigns_palette_in_level_order():
    sc = scales.resolve_scales(_enc(color="cond"), DF, SCHEMA, STYLE)
    assert "color" in sc.mapped
    # declared schema levels drive the order, not data appearance order
    assert sc.color_for("wt") == PAL[0]
    assert sc.color_for("ko") == PAL[1]


def test_color_levels_fall_back_to_sorted_uniques():
    sc = scales.resolve_scales(_enc(color="geno"), DF, SCHEMA, STYLE)
    assert sc.color_for("a") == PAL[0]
    assert sc.color_for("b") == PAL[1]


def test_numeric_size_maps_to_area_range():
    sc = scales.resolve_scales(_enc(size="dose"), DF, SCHEMA, STYLE)
    assert "size" in sc.mapped
    assert sc.size_for(0.0) == scales.SIZE_MIN_AREA   # min -> smallest
    assert sc.size_for(10.0) == scales.SIZE_MAX_AREA  # max -> largest
    mid = sc.size_for(5.0)
    assert scales.SIZE_MIN_AREA < mid < scales.SIZE_MAX_AREA


def test_categorical_shape_cycles_markers():
    sc = scales.resolve_scales(_enc(shape="geno"), DF, SCHEMA, STYLE)
    assert "shape" in sc.mapped
    assert sc.marker_for("a") == scales.MARKERS[0]
    assert sc.marker_for("b") == scales.MARKERS[1]


def test_no_channels_is_identity_with_palette0_fallback():
    sc = scales.resolve_scales(_enc(x="cond", y="y"), DF, SCHEMA, STYLE)
    assert sc.mapped == set()
    assert sc.color_for("anything") == PAL[0]   # single-series fallback
    assert sc.marker_for("anything") == scales.MARKERS[0]
    assert sc.legend_entries() == []


def test_legend_entries_describe_each_mapped_channel():
    sc = scales.resolve_scales(_enc(color="cond", shape="geno"), DF, SCHEMA, STYLE)
    by_channel = {e["channel"]: e for e in sc.legend_entries()}
    assert by_channel["color"]["label"] == "cond"
    assert [s["value"] for s in by_channel["color"]["swatches"]] == ["wt", "ko"]
    assert by_channel["color"]["swatches"][0]["color"] == PAL[0]
    assert by_channel["shape"]["label"] == "geno"
    assert by_channel["shape"]["swatches"][0]["marker"] == scales.MARKERS[0]
