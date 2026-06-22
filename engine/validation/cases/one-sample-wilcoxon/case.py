"""One sample vs a reference value, small n — the robust location family.

Nine measurements tested against a reference of 100. With n < 12 the engine's
small-sample rule selects the Wilcoxon signed-rank test rather than the
one-sample t (the parametric sibling is the `one-sample-location` case). The
reference line is drawn at 100.
"""

TITLE = "Measure vs reference (Wilcoxon signed-rank, small n)"
DATA = "data.csv"
SOURCE = "Synthetic; W/p recomputed with scipy.stats.wilcoxon (see NOTES)"
NOTES = """\
Nine values tested against reference = 100. n < 12 triggers the small-sample
rule, so the engine selects the Wilcoxon signed-rank one-sample test.

Independent recompute (outside Iris, raw scipy):
    scipy.stats.wilcoxon([v - 100 for v in values])
    -> W = 3.0, p = 0.01953125
    median = 105.2
"""
SCHEMA_OVERRIDES = {"group": {"type": "categorical", "levels": ["A"]}}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "group"},
                          "y": {"column": "measure"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "stats": {"family": "location", "reference": 100.0, "alpha": 0.05},
        },
        "expected_stats": {
            "test": "wilcoxon_signed",
            "reference": (100.0, 1e-12),
            "per_group.0.level": "A",
            "per_group.0.n": 9,
            "per_group.0.W": (3.0, 1e-9),
            "per_group.0.p": ("<", 0.05),
            "per_group.0.stars": "*",
        },
        "expected_model": {"family": "location", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "measure"},
            "xtick_labels": ["A"],
        },
    },
]
