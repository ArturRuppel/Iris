"""`join` with a right side that carries its own reduce + collapse sub-pipeline.

Two features can live at different grains — each a per-unit aggregate over its OWN
row support (e.g. a per-cell median over the frames where THAT feature is defined).
A single linear `reduce.steps → collapse` can only join at raw grain first, which
forces a common (intersected) support. Letting the join's `right` carry its own
`reduce`/`collapse` aggregates it independently before the merge, so each side keeps
its native support. Absent both, the right side is the plain static table.
"""
import pandas as pd

from iris_engine import reduce as rd


def _left():
    df = pd.DataFrame([{"id": "1", "cell": "A", "y": 10.0},
                       {"id": "2", "cell": "B", "y": 20.0}])
    schema = {"schema_version": "1.0", "columns": [
        {"name": "cell", "type": "identifier"},
        {"name": "y", "type": "numeric"}]}
    return df, schema


def _right(rows, *, reduce=None, collapse=None, test_grain=None):
    right = {"schema": {"schema_version": "1.0", "columns": [
                {"name": "cell", "type": "identifier"},
                {"name": "frame", "type": "numeric"},
                {"name": "w", "type": "numeric"}]},
             "rows": rows}
    if reduce is not None:
        right["reduce"] = reduce
    if collapse is not None:
        right["collapse"] = collapse
    if test_grain is not None:
        right["test_grain"] = test_grain
    return right


def test_join_collapses_right_over_its_own_support():
    left, lschema = _left()
    # A defined on frames {0,1}; B on {0,1,2} — a DIFFERENT per-cell support.
    rows = [{"id": "r1", "cell": "A", "frame": 0, "w": 4.0},
            {"id": "r2", "cell": "A", "frame": 1, "w": 6.0},     # A median = 5
            {"id": "r3", "cell": "B", "frame": 0, "w": 1.0},
            {"id": "r4", "cell": "B", "frame": 1, "w": 2.0},
            {"id": "r5", "cell": "B", "frame": 2, "w": 9.0}]     # B median = 2
    step = {"kind": "join", "on": ["cell"], "how": "inner",
            "right": _right(rows, collapse=[{"keep": ["cell"], "fn": "median"}],
                            test_grain="cell")}
    out, sch = rd.apply_reduction(left, lschema, [step])
    assert dict(zip(out["cell"], out["w"])) == {"A": 5.0, "B": 2.0}
    assert "w" in {c["name"] for c in sch["columns"]}


def test_right_reduce_runs_before_collapse():
    left, lschema = _left()
    rows = [{"id": "r1", "cell": "A", "frame": 0, "w": 2.0},
            {"id": "r2", "cell": "A", "frame": 1, "w": 4.0},     # w*10 → 20,40 → med 30
            {"id": "r3", "cell": "B", "frame": 0, "w": 5.0}]     # w*10 → 50
    right = _right(rows,
                   reduce={"steps": [{"kind": "derive", "column": "w",
                                      "expr": "w * 10"}]},
                   collapse=[{"keep": ["cell"], "fn": "median"}], test_grain="cell")
    out, _ = rd.apply_reduction(left, lschema, [{"kind": "join", "on": ["cell"],
                                                 "right": right}])
    assert dict(zip(out["cell"], out["w"])) == {"A": 30.0, "B": 50.0}


def test_static_right_unchanged():
    left, lschema = _left()
    # a plain per-cell right (no reduce/collapse) merges exactly as before
    rows = [{"id": "r1", "cell": "A", "frame": 0, "w": 7.0},
            {"id": "r2", "cell": "B", "frame": 0, "w": 8.0}]
    out, _ = rd.apply_reduction(left, lschema, [{"kind": "join", "on": ["cell"],
                                                 "right": _right(rows)}])
    assert dict(zip(out["cell"], out["w"])) == {"A": 7.0, "B": 8.0}
