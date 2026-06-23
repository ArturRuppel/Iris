"""join: inner, spine-aligned, coarse->fine broadcast; right table inline."""
import pandas as pd
import pytest

from iris_engine import reduce as rd

KEY = ["experiment_id", "position_id", "cell_id"]

LEFT_SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
        {"name": "position_id", "type": "identifier", "label": "Position"},
        {"name": "cell_id", "type": "identifier", "label": "Cell"},
        {"name": "frame", "type": "identifier", "label": "Frame"},
        {"name": "value", "type": "numeric", "label": "Value"},
    ],
}


def left():
    # two cells (c1, c2) x two frames each; c2 has NO class label in the right table
    rows = [
        {"id": "r1", "experiment_id": "E1", "position_id": "P1", "cell_id": "c1", "frame": 0, "value": 1.0},
        {"id": "r2", "experiment_id": "E1", "position_id": "P1", "cell_id": "c1", "frame": 1, "value": 2.0},
        {"id": "r3", "experiment_id": "E1", "position_id": "P1", "cell_id": "c2", "frame": 0, "value": 3.0},
        {"id": "r4", "experiment_id": "E1", "position_id": "P1", "cell_id": "c2", "frame": 1, "value": 4.0},
    ]
    return pd.DataFrame(rows)


def right_table():
    return {
        "schema": {
            "schema_version": "1.0",
            "columns": [
                {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
                {"name": "position_id", "type": "identifier", "label": "Position"},
                {"name": "cell_id", "type": "identifier", "label": "Cell"},
                {"name": "class_label", "type": "categorical", "label": "Class",
                 "levels": ["negative"]},
            ],
        },
        # only c1 is labelled; c2 is unclassified
        "rows": [
            {"experiment_id": "E1", "position_id": "P1", "cell_id": "c1",
             "class_label": "negative"},
        ],
    }


def join_step(on, right, how="inner"):
    return {"kind": "join", "on": on, "how": how, "right": right}


def test_join_broadcasts_label_onto_frames_inner_drops_unmatched():
    out, schema = rd.apply_reduction(left(), LEFT_SCHEMA, [
        join_step(KEY, right_table())])
    # c1's two frames survive carrying the label; c2's two frames are dropped (inner)
    assert out["id"].tolist() == ["r1", "r2"]
    assert out["class_label"].tolist() == ["negative", "negative"]
    # schema gained the right's class_label column (keys not duplicated)
    assert [c["name"] for c in schema["columns"]] == [
        "experiment_id", "position_id", "cell_id", "frame", "value", "class_label"]


def test_join_only_inner_supported():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(left(), LEFT_SCHEMA, [
            join_step(KEY, right_table(), how="left")])


def test_join_missing_key_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(left(), LEFT_SCHEMA, [
            join_step(["nope"], right_table())])


def test_join_rejects_many_to_many_right():
    rt = right_table()
    rt["rows"].append({"experiment_id": "E1", "position_id": "P1",
                       "cell_id": "c1", "class_label": "negative"})  # dup key
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(left(), LEFT_SCHEMA, [join_step(KEY, rt)])


def test_join_empty_right_raises_clear_error():
    rt = right_table()
    rt["rows"] = []
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(left(), LEFT_SCHEMA, [join_step(KEY, rt)])


def test_join_appends_multiple_new_right_columns():
    rt = right_table()
    rt["schema"]["columns"].append({"name": "donor", "type": "categorical",
                                    "label": "Donor", "levels": ["d1"]})
    rt["rows"][0]["donor"] = "d1"
    out, schema = rd.apply_reduction(left(), LEFT_SCHEMA, [join_step(KEY, rt)])
    assert "class_label" in out.columns and "donor" in out.columns
    names = [c["name"] for c in schema["columns"]]
    assert names[-2:] == ["class_label", "donor"]
    assert out["donor"].tolist() == ["d1", "d1"]
