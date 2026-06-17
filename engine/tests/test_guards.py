"""Geom-level validity guards. The point cap is the 82k-freeze fix."""
import pandas as pd

from iris_engine import guards, geoms

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "grp", "type": "categorical", "label": "Group",
     "levels": ["a", "b"]},
    {"name": "val", "type": "numeric", "label": "Value"},
]}


def frame(n_per_group):
    rows = []
    for g in ("a", "b"):
        for i in range(n_per_group):
            rows.append({"id": f"{g}{i}", "grp": g, "val": float(i),
                         "excluded": False})
    return pd.DataFrame(rows)


def spec(*geom_names):
    return {"encodings": {"x": {"column": "grp"}, "y": {"column": "val"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": g, "params": {}} for g in geom_names]}


def test_dot_over_cap_is_blocking():
    df = frame(geoms.POINT_CAP)  # 2 * POINT_CAP rows, well over the cap
    issues = guards.evaluate(df, SCHEMA, spec("dot"), stat_model=None)
    blocking = [i for i in issues if i["level"] == "blocking"]
    assert blocking and blocking[0]["geom"] == "dot"
    assert f"{len(df):,}" in blocking[0]["message"]  # comma-formatted count


def test_dot_under_cap_is_clean():
    df = frame(5)  # 10 rows
    issues = guards.evaluate(df, SCHEMA, spec("dot"), stat_model=None)
    assert [i for i in issues if i["level"] == "blocking"] == []


def test_aggregating_geom_never_trips_the_point_cap():
    df = frame(geoms.POINT_CAP)
    issues = guards.evaluate(df, SCHEMA, spec("bar"), stat_model=None)
    assert issues == []


def test_box_below_min_n_warns():
    df = frame(2)  # 2 per group, below the box minimum
    issues = guards.evaluate(df, SCHEMA, spec("box"), stat_model=None)
    warn = [i for i in issues if i["level"] == "warning"]
    assert warn and warn[0]["geom"] == "box"


def _aes_spec(geom, **channels):
    enc = {"x": {"column": "grp"}, "y": {"column": "val"},
           "color": None, "size": None, "shape": None}
    enc.update({k: {"column": v} for k, v in channels.items()})
    return {"encodings": enc, "layers": [{"geom": geom, "params": {}}]}


def test_size_on_a_box_only_plot_warns_channel_ignored():
    df = frame(5)
    issues = guards.evaluate(df, SCHEMA, _aes_spec("box", size="val"),
                             stat_model=None)
    codes = {i["code"] for i in issues}
    assert "channel_ignored" in codes      # box has no size channel


def test_color_on_a_scatter_is_not_ignored():
    df = frame(5)
    issues = guards.evaluate(df, SCHEMA, _aes_spec("dot", color="grp"),
                             stat_model=None)
    assert [i for i in issues if i["code"] == "channel_ignored"] == []


def test_numeric_color_is_renderable_kept_and_not_palette_warned():
    # Phase 3b: a numeric color resolves through a continuous colormap, so it is
    # kept (not dropped) and never trips channel_unrenderable / palette_exhausted
    # — a colorbar has no discrete palette to exhaust.
    rows = [{"id": f"r{i}", "grp": "a" if i % 2 else "b", "val": float(i),
             "excluded": False} for i in range(20)]   # 20 distinct color values
    df = pd.DataFrame(rows)
    s = _aes_spec("dot", color="val")          # val is numeric → continuous color
    issues = guards.evaluate(df, SCHEMA, s, stat_model=None)
    assert s["encodings"]["color"] == {"column": "val"}    # kept
    assert [i for i in issues if i["code"] in ("channel_unrenderable",
                                               "palette_exhausted")] == []


def test_numeric_shape_and_categorical_size_are_unrenderable():
    df = frame(5)
    s = _aes_spec("dot", shape="val")          # numeric shape: can't be continuous
    issues = guards.evaluate(df, SCHEMA, s, stat_model=None)
    assert any(i["code"] == "channel_unrenderable" for i in issues)
    assert s["encodings"]["shape"] is None

    s2 = _aes_spec("dot", size="grp")          # categorical size: not a thing
    issues2 = guards.evaluate(df, SCHEMA, s2, stat_model=None)
    assert any(i["code"] == "channel_unrenderable" for i in issues2)
    assert s2["encodings"]["size"] is None


def test_renderable_aesthetic_channels_are_kept():
    # categorical color + numeric size are renderable today → not dropped
    df = frame(5)
    s = _aes_spec("dot", color="grp", size="val")
    guards.evaluate(df, SCHEMA, s, stat_model=None)
    assert s["encodings"]["color"] == {"column": "grp"}
    assert s["encodings"]["size"] == {"column": "val"}


def test_high_cardinality_color_warns_palette_exhausted():
    n = guards.COLOR_CAP + 1                # one more level than the palette holds
    rows = [{"id": f"r{i}", "grp": f"g{i}", "val": float(i), "excluded": False}
            for i in range(n)]             # distinct color levels > palette → repeat
    df = pd.DataFrame(rows)
    schema = {"schema_version": "1.0", "columns": [
        {"name": "grp", "type": "categorical", "label": "Group"},
        {"name": "val", "type": "numeric", "label": "Value"}]}
    issues = guards.evaluate(df, schema, _aes_spec("dot", color="grp"),
                             stat_model=None)
    codes = {i["code"] for i in issues}
    assert "palette_exhausted" in codes


def _facet_spec(geom, row=None, col=None):
    s = spec(geom)
    s["facet"] = {
        "row": {"column": row} if row else None,
        "col": {"column": col} if col else None,
        "share_x": True, "share_y": True,
    }
    return s


def _facet_frame(n_row_levels, n_col_levels, n_per_cell=2):
    rows = []
    i = 0
    for ri in range(n_row_levels):
        for ci in range(n_col_levels):
            for g in ("a", "b"):
                for _ in range(n_per_cell):
                    i += 1
                    rows.append({"id": f"r{i}", "grp": g, "val": float(i),
                                "row_facet": f"r{ri}", "col_facet": f"c{ci}",
                                "excluded": False})
    return pd.DataFrame(rows)


def test_no_facet_mapped_is_clean():
    df = frame(5)
    issues = guards.evaluate(df, SCHEMA, _facet_spec("bar"), stat_model=None)
    assert [i for i in issues if i["code"] == "facet_cell_cap"] == []


def test_facet_within_cap_is_clean():
    df = _facet_frame(4, 5)  # 20 cells == cap, not over it
    issues = guards.evaluate(df, SCHEMA, _facet_spec("bar", row="row_facet",
                                                      col="col_facet"),
                             stat_model=None)
    assert [i for i in issues if i["code"] == "facet_cell_cap"] == []


def test_facet_over_cap_is_blocking():
    df = _facet_frame(5, 5)  # 25 cells > 20 cap
    issues = guards.evaluate(df, SCHEMA, _facet_spec("bar", row="row_facet",
                                                      col="col_facet"),
                             stat_model=None)
    blocking = [i for i in issues if i["code"] == "facet_cell_cap"]
    assert blocking and blocking[0]["level"] == "blocking"
    assert "25" in blocking[0]["message"]


def test_facet_row_only_over_cap_is_blocking():
    df = _facet_frame(25, 1)  # 25 row levels, no col facet
    issues = guards.evaluate(df, SCHEMA, _facet_spec("bar", row="row_facet"),
                             stat_model=None)
    assert [i for i in issues if i["code"] == "facet_cell_cap"]
