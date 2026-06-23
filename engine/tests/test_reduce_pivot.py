"""pivot: unstack one categorical key into one column per level (sum, 0-fill)."""
import pandas as pd

from iris_engine import reduce as rd

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "cell", "type": "identifier", "label": "Cell"},
    {"name": "opp", "type": "categorical", "label": "Opp", "levels": [0, 1]},
    {"name": "n", "type": "numeric", "label": "N"}]}


def frame():
    # cell c1 has rows for opp in {0, 1}; cell c2 has only opp == 0.
    return pd.DataFrame([
        {"id": "r1", "cell": "c1", "opp": 0, "n": 3},
        {"id": "r2", "cell": "c1", "opp": 0, "n": 4},  # same (cell, opp) -> sums to 7
        {"id": "r3", "cell": "c1", "opp": 1, "n": 5},
        {"id": "r4", "cell": "c2", "opp": 0, "n": 2}])


def piv(index, column, values, names):
    return {"kind": "pivot", "index": index, "column": column,
            "values": values, "agg": "sum", "fill": 0, "names": names}


def test_pivot_unstacks_opp_into_s_and_o_columns():
    out, schema = rd.apply_reduction(
        frame(), SCHEMA,
        [piv(["cell"], "opp", "n", {0: "s", 1: "o"})])

    # one row per index tuple
    assert out["cell"].tolist() == ["c1", "c2"]
    assert len(out) == 2

    # columns include the new pivoted columns
    assert "s" in out.columns
    assert "o" in out.columns

    by_cell = out.set_index("cell")
    assert by_cell.loc["c1", "s"] == 7  # 3 + 4 summed
    assert by_cell.loc["c1", "o"] == 5
    # c2 had no opp==1 row -> filled with 0
    assert by_cell.loc["c2", "s"] == 2
    assert by_cell.loc["c2", "o"] == 0

    # the consumed column/values are gone; the new columns are numeric
    names = {c["name"]: c for c in schema["columns"]}
    assert "opp" not in names
    assert "n" not in names
    assert names["s"]["type"] == "numeric"
    assert names["o"]["type"] == "numeric"
    # index key column is kept
    assert "cell" in names
