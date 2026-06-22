"""Aesthetic scale resolution: encodings + data -> color/size/shape lookups."""
import numpy as np
import pandas as pd

from iris_engine import scales

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


def test_numeric_color_resolves_continuous_not_palette():
    # Phase 3b: a numeric color column becomes a continuous colormap (range +
    # cmap), NOT discrete palette swatches.
    sc = scales.resolve_scales(_enc(color="dose"), DF, SCHEMA, STYLE)
    assert "color" in sc.mapped
    assert sc.color_numeric is True
    assert sc.color_lo == 0.0 and sc.color_hi == 10.0   # data range of dose
    assert sc.color_cmap == scales.COLOR_CMAP
    assert sc.color_levels == []                         # no discrete levels


def test_numeric_color_emits_colorbar_not_legend_swatches():
    sc = scales.resolve_scales(_enc(color="dose"), DF, SCHEMA, STYLE)
    # no color entry in the swatch legend …
    assert [e for e in sc.legend_entries() if e["channel"] == "color"] == []
    # … instead a colorbar spec carries label + range + cmap
    cb = sc.colorbar_spec()
    assert cb == {"label": "dose", "vmin": 0.0, "vmax": 10.0,
                  "cmap": scales.COLOR_CMAP}


def test_categorical_color_has_no_colorbar_spec():
    sc = scales.resolve_scales(_enc(color="cond"), DF, SCHEMA, STYLE)
    assert sc.color_numeric is False
    assert sc.colorbar_spec() is None


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


def test_color_and_shape_on_same_column_merge_into_one_entry():
    # Item J: when color and shape map the SAME categorical column, the two
    # channels collapse to ONE legend block whose every swatch carries both the
    # color and the marker — not two redundant blocks with the same labels.
    sc = scales.resolve_scales(_enc(color="cond", shape="cond"), DF, SCHEMA, STYLE)
    entries = sc.legend_entries()
    assert len(entries) == 1
    e = entries[0]
    assert e["channel"] == "color+shape"
    assert e["label"] == "cond"
    assert [s["value"] for s in e["swatches"]] == ["wt", "ko"]
    assert e["swatches"][0]["color"] == PAL[0]
    assert e["swatches"][0]["marker"] == scales.MARKERS[0]


def test_numeric_color_with_shape_on_same_column_does_not_merge():
    # A numeric color is a colorbar, not discrete swatches — it can't fuse with
    # the shape markers, so the shape entry stands alone (color → colorbar).
    sc = scales.resolve_scales(_enc(color="dose", shape="dose"), DF, SCHEMA, STYLE)
    channels = [e["channel"] for e in sc.legend_entries()]
    assert channels == ["shape"]
    assert sc.colorbar_spec() is not None
