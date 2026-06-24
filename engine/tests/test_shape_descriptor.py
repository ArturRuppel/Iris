import pandas as pd
from iris_engine.shape import _axis_is_ragged, describe_shape, value_grain

# spine coarsest -> finest
SPINE = ["experiment", "position", "cell", "frame"]

def _frame():
    # 1 experiment, 2 cells, 2 frames each; class is constant within a cell,
    # speed varies per frame, treatment is constant everywhere.
    return pd.DataFrame({
        "experiment": ["E1"] * 4,
        "position":   ["P1"] * 4,
        "cell":       ["c1", "c1", "c2", "c2"],
        "frame":      [1, 2, 1, 2],
        "speed":      [2.1, 1.8, 3.4, 2.9],
        "class":      ["div", "div", "non", "non"],
        "treatment":  ["A", "A", "A", "A"],
    })

def test_value_grain_per_cell_value_tags_cell():
    assert value_grain(_frame(), SPINE, "class") == "cell"

def test_value_grain_per_frame_value_is_none():
    # speed varies frame-to-frame -> only constant at the row grain -> no tag
    assert value_grain(_frame(), SPINE, "speed") is None

def test_value_grain_global_constant_tags_coarsest():
    # constant everywhere -> constant within the coarsest group -> coarsest axis
    assert value_grain(_frame(), SPINE, "treatment") == "experiment"

def test_value_grain_ignores_spine_columns_absent_from_frame():
    df = _frame().drop(columns=["position"])
    assert value_grain(df, SPINE, "class") == "cell"

def test_axis_ragged_when_child_count_varies_per_parent():
    # c1 has 3 frames, c2 has 1 -> frame is ragged within cell
    df = pd.DataFrame({
        "experiment": ["E1"] * 4,
        "position":   ["P1"] * 4,
        "cell":       ["c1", "c1", "c1", "c2"],
        "frame":      [1, 2, 3, 1],
    })
    spine = ["experiment", "position", "cell", "frame"]
    assert _axis_is_ragged(df, spine, 3) is True   # frame
    assert _axis_is_ragged(df, spine, 0) is False  # experiment (coarsest)

def test_axis_not_ragged_when_balanced():
    df = pd.DataFrame({
        "experiment": ["E1"] * 4,
        "cell":       ["c1", "c1", "c2", "c2"],
        "frame":      [1, 2, 1, 2],
    })
    spine = ["experiment", "cell", "frame"]
    assert _axis_is_ragged(df, spine, 2) is False  # 2 frames per cell, balanced

SCHEMA = {"columns": [
    {"name": "experiment", "type": "identifier"},
    {"name": "position",   "type": "identifier"},
    {"name": "cell",       "type": "identifier"},
    {"name": "frame",      "type": "identifier"},
    {"name": "speed",      "type": "numeric"},
    {"name": "class",      "type": "categorical"},
]}

def test_describe_shape_axes_in_spine_order_with_levels():
    out = describe_shape(_frame(), SCHEMA, SPINE)
    assert [a["name"] for a in out["axes"]] == ["experiment", "position", "cell", "frame"]
    cell = next(a for a in out["axes"] if a["name"] == "cell")
    assert cell["n_levels"] == 2 and cell["ragged"] is False

def test_describe_shape_values_carry_type_and_grain():
    out = describe_shape(_frame(), SCHEMA, SPINE)
    vals = {v["name"]: v for v in out["values"]}
    assert vals["speed"]["type"] == "numeric" and vals["speed"]["grain"] is None
    assert vals["class"]["type"] == "categorical" and vals["class"]["grain"] == "cell"

def test_describe_shape_excludes_meta_columns():
    df = _frame().assign(id=["1", "2", "3", "4"], row_ids=[[1]] * 4)
    out = describe_shape(df, SCHEMA, SPINE)
    names = {v["name"] for v in out["values"]}
    assert "id" not in names and "row_ids" not in names

def test_describe_shape_unknown_value_type_defaults_numeric():
    df = _frame().assign(extra=[1.0, 2.0, 3.0, 4.0])  # not in SCHEMA
    out = describe_shape(df, SCHEMA, SPINE)
    extra = next(v for v in out["values"] if v["name"] == "extra")
    assert extra["type"] == "numeric"
