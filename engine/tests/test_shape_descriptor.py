import pandas as pd
from iris_engine.shape import _axis_is_ragged, value_grain

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
