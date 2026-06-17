"""Synthetic two-group data — the nonparametric two-group cell (Mann–Whitney U).

No clean published nonparametric statistic exists, so the dataset is synthetic and
the statistic is exact by construction (the reduction-collapse case set this
precedent). Two groups of 12, overlapping but shifted; the user picks
``mann_whitney`` and the corpus asserts U against an independent scipy recompute.
"""

TITLE = "Two-group comparison — Mann–Whitney U (synthetic)"
DATA = "data.csv"
SOURCE = "synthetic — known by construction; recomputed with scipy.stats.mannwhitneyu"
NOTES = """\
Two synthetic groups (n = 12 each), overlapping but shifted:
    A: 4.1 5.2 5.8 6.0 6.3 6.7 7.1 7.4 7.8 8.2 8.5 9.0
    B: 6.1 6.9 7.6 8.1 8.4 8.8 9.2 9.6 10.1 10.5 11.0 11.6

Independent recompute (outside Iris, raw scipy 1.16.3):
    scipy.stats.mannwhitneyu(A, B, alternative="two-sided")
    -> U = 24.0, p = 0.006099 ; nA = nB = 12
    rank-biserial r = 2*U/(nA*nB) - 1 = -0.666667

The rank-biserial is negative because group A's ranks sit below group B's; its sign
follows pingouin's convention. No selection is asserted — the user names the test.
"""
SCHEMA_OVERRIDES = {
    "group": {"type": "categorical", "levels": ["A", "B"]},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"respect_exclusions": True},
            "encodings": {"x": {"column": "group"},
                          "y": {"column": "value"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "stats": {"alpha": 0.05, "override": "mann_whitney"},
        },
        "expected_stats": {
            "test": "mann_whitney",
            "U": (24.0, 1e-9),
            "p": (0.006099, 1e-5),
            "effect.value": (-0.666667, 1e-5),  # rank-biserial r
            "summaries.0.n": 12,
            "summaries.1.n": 12,
        },
        "expected_model": {"family": "group_comparison", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "value"},
            "xtick_labels": ["A", "B"],
            "point_groups": 0,               # box only — no per-point marks
        },
    },
]
