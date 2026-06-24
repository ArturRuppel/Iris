"""Orange tree circumference over time — the time-series family (describe-only).

Five trees measured at seven ages. Iris's time-series family describes the
trajectories (`line`) and the mean ± spread band (`trend`); it runs no
inferential test in this tier, so the case guards the describe-only verdict and
the figure structure, not a p-value.
"""

TITLE = "Orange tree growth over time"
DATA = "data.csv"
SOURCE = "Draper & Smith (1998), Applied Regression Analysis; R datasets::Orange"
NOTES = """\
Circumference (mm) of five orange trees at seven ages (days since 1968-12-31).
Time series is describe-only in this tier: the engine reports timepoint count and
x-span and renders trajectories / trend band, with no inferential test.
"""
SCHEMA_OVERRIDES = {"tree": {"type": "categorical"}}

_BASE = {
    "spec_version": "2.1",
    "title": TITLE,
    "data": {"filter": []},
    "encodings": {"x": {"column": "age"}, "y": {"column": "circumference"},
                  "color": None, "size": None, "shape": None},
    "reduce": {"steps": []},
    "stats": {"alpha": 0.05},
}

ANALYSES = [
    {
        "spec": {**_BASE, "encodings": {**_BASE["encodings"], "color": {"column": "tree"}},
                 "layers": [{"geom": "line", "params": {}}]},
        "expected_stats": {"n": 35},
        "expected_model": {"family": "timeseries", "chosen_by": "describe_only"},
        "expected_figure": {"axis_labels": {"x": "age", "y": "circumference"}},
    },
    {
        "spec": {**_BASE, "layers": [{"geom": "trend", "params": {}}]},
        "expected_stats": {"n": 35},
        "expected_model": {"family": "timeseries", "chosen_by": "describe_only"},
        "expected_figure": {"axis_labels": {"x": "age", "y": "circumference"}},
    },
]
