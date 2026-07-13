import pandas as pd
from iris_engine.hierarchy import join_leaf_key

SPINE = ["experiment", "position", "cell", "frame"]
SCHEMA = {"columns": [{"name": n, "type": "categorical", "identifier": True}
                      for n in SPINE]}

def _left():
    # cell ids c1/c2 recur across BOTH positions -> 'cell' alone is not unique
    return pd.DataFrame({
        "experiment": ["E1"] * 4,
        "position":   ["P1", "P1", "P2", "P2"],
        "cell":       ["c1", "c2", "c1", "c2"],
        "frame":      [1, 1, 1, 1],
    })

def test_warns_when_joining_on_bare_leaf():
    steps = [{"kind": "join", "on": ["cell"], "right": {}}]
    out = join_leaf_key(_left(), SCHEMA, SPINE, steps)
    assert len(out) == 1
    assert out[0]["severity"] == "caution"
    assert out[0]["step"] == 0
    assert "experiment" in out[0]["text"] and "position" in out[0]["text"]

def test_step_index_is_the_offending_join_position():
    # first join is safe (full path), second join (index 1) offends on bare cell
    steps = [
        {"kind": "join", "on": ["experiment", "position", "cell"], "right": {}},
        {"kind": "join", "on": ["cell"], "right": {}},
    ]
    out = join_leaf_key(_left(), SCHEMA, SPINE, steps)
    assert len(out) == 1
    assert out[0]["step"] == 1

def test_no_warn_when_full_path_supplied():
    steps = [{"kind": "join", "on": ["experiment", "position", "cell"], "right": {}}]
    assert join_leaf_key(_left(), SCHEMA, SPINE, steps) == []

def test_no_warn_when_leaf_is_globally_unique():
    df = _left().assign(cell=["c1", "c2", "c3", "c4"])  # cell now unique on its own
    steps = [{"kind": "join", "on": ["cell"], "right": {}}]
    assert join_leaf_key(df, SCHEMA, SPINE, steps) == []

def test_ignores_non_join_steps():
    steps = [{"kind": "filter", "conditions": []}]
    assert join_leaf_key(_left(), SCHEMA, SPINE, steps) == []
