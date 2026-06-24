"""Correlation through the collapse plan + post-collapse reduce phase.

The other inferential families (group_comparison / location / rate) materialize the
chosen test grain and run `reduce.post` there before the stat; the correlation
family did not — it correlated the raw reduced rows directly, so a per-cell
association measured over per-frame rows was pseudoreplicated within each cell.

These pin: (1) a `collapse` plan aggregates the raw rows to the test grain (e.g.
per-cell median) and the coefficient is computed on THAT grain, matching a direct
per-cell `stats.correlation`; (2) the collapsed grain differs materially from the
raw-row correlation (the wiring actually changed the grain); (3) `reduce.post` runs
on the collapsed grain so a post-aggregate derive can supply the X/Y column (the §4
`het` / N-way-join path); (4) absent `collapse` and `reduce.post`, the result is
byte-for-byte the historical raw-row path.
"""
import json

import matplotlib
matplotlib.use("Agg")
import numpy as np
import pandas as pd
import pytest

from iris_engine import main, stats


def _frame_df(seed=3):
    """3 experiments × 12 cells × 5 frames. Each CELL has a true (x, y) with a
    consistent negative within-experiment association; per-frame noise is large
    enough that the per-frame cloud is a different correlation than the per-cell
    one."""
    rng = np.random.default_rng(seed)
    rows = []
    for ei, off in enumerate([0.0, 6.0, 12.0]):
        for ci in range(12):
            cx = rng.uniform(0, 5)
            cy = off - 0.8 * cx + rng.normal(0, 0.4)
            for fr in range(5):
                rows.append({
                    "experiment_id": f"E{ei}", "cell_id": ci * 10 + ei, "frame": fr,
                    "x": cx + rng.normal(0, 1.5), "y": cy + rng.normal(0, 1.5)})
    df = pd.DataFrame(rows)
    df.insert(0, "id", [f"r{i}" for i in range(len(df))])
    return df


def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "id", "type": "identifier"},
        {"name": "experiment_id", "type": "identifier", "label": "experiment"},
        {"name": "cell_id", "type": "identifier", "label": "cell"},
        {"name": "frame", "type": "numeric", "label": "frame"},
        {"name": "x", "type": "numeric", "label": "X"},
        {"name": "y", "type": "numeric", "label": "Y"}]}


def _spec(*, collapse=True, post=None):
    spec = {"spec_version": "2.0", "title": "t",
            "encodings": {"x": {"column": "x"}, "y": {"column": "y"},
                          "color": None, "size": None, "shape": None},
            "hierarchy": {"spine": ["experiment_id"], "fn": {}},
            "layers": [{"geom": "scatter", "params": {}},
                       {"geom": "regression", "params": {}}],
            "stats": {"family": "correlation", "alpha": 0.05}, "_override": "spearman"}
    if collapse:
        spec["collapse"] = [{"keep": ["experiment_id", "cell_id"], "fn": "median"}]
        spec["test_grain"] = "experiment_id/cell_id"
    if post is not None:
        spec.setdefault("reduce", {})["post"] = post
    return spec


def _render(df, spec):
    recs = json.loads(df.to_json(orient="records"))
    _, res, *_ = main._run({"schema": _schema(), "rows": recs}, spec)
    return res


def test_collapse_correlates_on_the_per_cell_grain():
    df = _frame_df()
    res = _render(df, _spec(collapse=True))
    # ground truth: collapse to per-cell median ourselves, then the same spined corr
    per_cell = (df.groupby(["experiment_id", "cell_id"], sort=False)[["x", "y"]]
                  .median().reset_index())
    exp = stats.correlation(per_cell, "x", "y", unit_cols=["experiment_id"],
                            override="spearman")["result"]
    assert res["result"]["n"] == exp["n"] == 3            # unit = experiment
    assert res["result"]["r"] == pytest.approx(exp["r"], rel=1e-9)
    assert res["result"]["p"] == pytest.approx(exp["p"], rel=1e-9)


def test_collapse_differs_from_raw_rows():
    df = _frame_df()
    collapsed = _render(df, _spec(collapse=True))["result"]
    raw = _render(df, _spec(collapse=False))["result"]
    # raw correlates 180 per-frame rows per experiment; collapsed correlates 12 cells
    assert raw["n"] == 3 and collapsed["n"] == 3
    # the per-frame noise dilutes the association: the two coefficients disagree
    assert abs(raw["r"] - collapsed["r"]) > 0.1


def test_reduce_post_supplies_a_post_aggregate_column():
    df = _frame_df()
    # collapse to per-cell, then derive y2 = y * 2 on the aggregated grain and
    # correlate against it — exercises reduce.post feeding the correlation X/Y.
    spec = _spec(collapse=True, post=[{"kind": "derive", "column": "y2",
                                       "expr": "y * 2"}])
    spec["encodings"]["y"] = {"column": "y2"}
    res = _render(df, spec)["result"]
    per_cell = (df.groupby(["experiment_id", "cell_id"], sort=False)[["x", "y"]]
                  .median().reset_index())
    per_cell["y2"] = per_cell["y"] * 2
    exp = stats.correlation(per_cell, "x", "y2", unit_cols=["experiment_id"],
                            override="spearman")["result"]
    assert res["r"] == pytest.approx(exp["r"], rel=1e-9)
    assert res["p"] == pytest.approx(exp["p"], rel=1e-9)


def test_no_collapse_is_unchanged():
    df = _frame_df()
    res = _render(df, _spec(collapse=False))["result"]
    direct = stats.correlation(df, "x", "y", unit_cols=["experiment_id"],
                               override="spearman")["result"]
    assert res["r"] == pytest.approx(direct["r"], rel=1e-12)
    assert res["p"] == pytest.approx(direct["p"], rel=1e-12)
    assert res["n"] == direct["n"]
