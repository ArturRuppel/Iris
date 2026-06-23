"""grid_complete: cross-join observed ids x a fixed level list, count, 0-fill.

§5's (field x transition) rate grid: an absent (field, tt) cell is a real 0,
not missing. Cross-join the observed `by` ids with the fixed `levels`, count
the events per (by + [column]), and fill absent cells with 0.
"""
import pandas as pd
import pytest

from iris_engine import reduce as rd

BY = ["experiment_id", "position_id"]
TT_LEVELS = ["homo->homo", "hetero->homo", "homo->hetero"]

SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
        {"name": "position_id", "type": "identifier", "label": "Position"},
        {"name": "tt", "type": "categorical", "label": "Transition",
         "levels": TT_LEVELS},
        {"name": "ev", "type": "identifier", "label": "Event"},
    ],
}


def frame():
    # one field: E1/P1. Two transitions present, the third (homo->hetero) absent.
    # ev "x1" appears twice (a per-cell duplicate) so count_unique can dedup it.
    rows = [
        {"id": "r1", "experiment_id": "E1", "position_id": "P1",
         "tt": "homo->homo", "ev": "x1"},
        {"id": "r2", "experiment_id": "E1", "position_id": "P1",
         "tt": "homo->homo", "ev": "x1"},
        {"id": "r3", "experiment_id": "E1", "position_id": "P1",
         "tt": "homo->homo", "ev": "x2"},
        {"id": "r4", "experiment_id": "E1", "position_id": "P1",
         "tt": "hetero->homo", "ev": "x3"},
    ]
    return pd.DataFrame(rows)


def grid(by, column, levels, count_unique=None):
    return {"kind": "grid_complete", "by": by, "column": column,
            "levels": levels, "count": True, "count_unique": count_unique,
            "fill": 0, "count_name": "count"}


def test_grid_completes_levels_with_zero_fill():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        grid(BY, "tt", TT_LEVELS)])
    # one field x three levels = three rows
    assert len(out) == 3
    assert set(out["tt"]) == set(TT_LEVELS)
    by_tt = out.set_index(["experiment_id", "position_id", "tt"])["count"]
    # raw row count (no dedup): homo->homo has 3 rows
    assert by_tt[("E1", "P1", "homo->homo")] == 3
    assert by_tt[("E1", "P1", "hetero->homo")] == 1
    # the absent cell is a real 0
    assert by_tt[("E1", "P1", "homo->hetero")] == 0
    # counts are integers
    assert out["count"].dtype.kind == "i"


def test_grid_count_unique_dedups_before_counting():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        grid(BY, "tt", TT_LEVELS, count_unique="ev")])
    by_tt = out.set_index(["experiment_id", "position_id", "tt"])["count"]
    # homo->homo had ev {x1, x1, x2} -> 2 distinct events
    assert by_tt[("E1", "P1", "homo->homo")] == 2
    assert by_tt[("E1", "P1", "hetero->homo")] == 1
    assert by_tt[("E1", "P1", "homo->hetero")] == 0


def test_grid_schema_has_column_and_count():
    out, schema = rd.apply_reduction(frame(), SCHEMA, [
        grid(BY, "tt", TT_LEVELS)])
    cols = {c["name"]: c for c in schema["columns"]}
    # the by columns survive
    assert "experiment_id" in cols and "position_id" in cols
    # the level column is categorical carrying the fixed levels
    assert cols["tt"]["type"] == "categorical"
    assert cols["tt"]["levels"] == TT_LEVELS
    # the count column is numeric
    assert cols["count"]["type"] == "numeric"


def test_grid_unknown_by_column_raises():
    with pytest.raises(rd.ReduceError):
        rd.apply_reduction(frame(), SCHEMA, [
            grid(["nope"], "tt", TT_LEVELS)])
