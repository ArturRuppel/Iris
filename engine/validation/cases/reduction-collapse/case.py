"""Filter → per-well grain (data hierarchy) then a group comparison — guards the
newest, least-covered engine surface: that the figure and the inferential test
read the SAME materialized grain, never a parallel route.

Synthetic, cells_by_frame-shaped: per-cell rows under conditions ctrl/trt plus a
junk 'blank' condition (quality = 0). The pipeline filters quality > 0 (dropping
blank); the hierarchy spine is `well` (cells nest in wells), and the box layer is
bound to level `well`, so the grain the box draws *and* the grain the comparison
tests is the per-well mean — `condition` is the orthogonal qualifier compared on
x. Built so the per-well grain — and thus the comparison — is known exactly: the
per-cell offsets sum to zero, making every well mean exact. The test is pinned to
Welch's t (override) so the assertion is independent of the small-sample
selection heuristic; t/p are recomputed from the known well means.
"""
import csv
from pathlib import Path

TITLE = "Per-well value: ctrl vs trt (filter + hierarchy level)"
DATA = "data.csv"
SOURCE = "analytic — known by construction; Welch's t recomputed with scipy (NOTES)"

OFFSETS = [-0.3, -0.1, 0.1, 0.3]   # sum to 0 -> exact per-well means

NOTES = """\
Construction (deterministic): 15 wells per real condition, 4 cells per well.
Well means: ctrl = 10.0, 10.5, ... 17.0 ; trt = 13.0, 13.5, ... 20.0 (step 0.5).
The four per-cell offsets [-0.3,-0.1,0.1,0.3] sum to zero, so each well's mean is
exact. A 'blank' condition (quality = 0, value = 999) is added and removed by the
filter.

After filter (quality > 0) + hierarchy level `well` (mean over the 4 cells per
well), the comparison runs on the per-well means:
    ctrl: n = 15, mean = 13.5   (exact)
    trt:  n = 15, mean = 16.5   (exact)
    mean difference = -3.0      (exact)

Independent recompute (outside Iris, raw scipy 1.16.3) on the known well means:
    scipy.stats.ttest_ind(ctrl_means, trt_means, equal_var=False)
    -> t = -3.674235, df = 28.0, p = 9.9914e-04
"""
# `well` is the nesting spine; `cell` an identifier finer than it (dropped at the
# well grain); `condition` the categorical qualifier compared on x.
SCHEMA_OVERRIDES = {
    "condition": {"type": "categorical", "levels": ["ctrl", "trt"]},
    "well": {"type": "identifier"},
    "cell": {"type": "identifier"},
}


def regenerate_data() -> None:
    """Rewrite data.csv (deterministic)."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["condition", "well", "cell", "quality", "value"])
        for cond, base in (("ctrl", 10.0), ("trt", 13.0)):
            for wi in range(15):
                m = base + 0.5 * wi
                for k, o in enumerate(OFFSETS):
                    w.writerow([cond, f"w{wi:02d}", k, 1, round(m + o, 4)])
        for wi in range(5):
            for k in range(4):
                w.writerow(["blank", f"b{wi:02d}", k, 0, 999.0])


ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"respect_exclusions": True},
            "encodings": {"x": {"column": "condition"},
                          "y": {"column": "value"},
                          "color": None, "size": None, "shape": None},
            "hierarchy": {"spine": ["well"], "fn": {}},
            "layers": [{"geom": "box", "params": {}, "level": "well"}],
            "reduce": {"steps": [
                {"kind": "filter",
                 "conditions": [{"column": "quality", "op": ">", "value": 0}]}]},
            "stats": {"alpha": 0.05, "chosen_by": "recommendation_accepted",
                      "test": "welch_t", "override": "welch_t"},
        },
        "expected_stats": {
            "test": "welch_t",
            "mean_diff": (-3.0, 1e-9),          # exact by construction
            "t": (-3.674235, 1e-4),
            "df": (28.0, 1e-9),
            "p": ("<", 1e-3),                   # p = 9.99e-04
            "summaries.0.n": 15,
            "summaries.1.n": 15,
            "summaries.0.mean": (13.5, 1e-9),
            "summaries.1.mean": (16.5, 1e-9),
        },
        "expected_model": {"family": "group_comparison",
                           "chosen_by": "inferred",
                           "inferential_level": "well"},
        "expected_figure": {
            "axis_labels": {"y": "value"},
            "xtick_labels": ["ctrl", "trt"],
            "point_groups": 0,
        },
    },
]
