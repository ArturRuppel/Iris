"""Synthetic two-group data — the nonparametric two-group cell (Mann–Whitney U).

Two groups of 12, overlapping but shifted; the user picks ``mann_whitney``. Iris
runs U through scipy.stats.mannwhitneyu, so the corpus does not pin U/p — a scipy
recompute would just be scipy-vs-scipy. It asserts the test wiring and the
by-construction group sizes, plus the figure.
"""

TITLE = "Two-group comparison — Mann–Whitney U (synthetic)"
DATA = "data.csv"
SOURCE = "synthetic — known by construction"
NOTES = """\
Two synthetic groups (n = 12 each), overlapping but shifted:
    A: 4.1 5.2 5.8 6.0 6.3 6.7 7.1 7.4 7.8 8.2 8.5 9.0
    B: 6.1 6.9 7.6 8.1 8.4 8.8 9.2 9.6 10.1 10.5 11.0 11.6

Iris computes U with scipy.stats.mannwhitneyu, so the corpus does not assert U/p
(that would be scipy-vs-scipy); it checks the test wiring and the by-construction
group sizes. No selection is asserted — the user names the test.
"""
SCHEMA_OVERRIDES = {
    "group": {"type": "categorical", "levels": ["A", "B"]},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "group"},
                          "y": {"column": "value"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "stats": {"alpha": 0.05, "override": "mann_whitney"},
        },
        "expected_stats": {
            "test": "mann_whitney",
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
