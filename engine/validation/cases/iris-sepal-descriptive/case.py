"""Sepal length distribution on Fisher's iris — the descriptive family."""

TITLE = "Sepal length distribution (Fisher's iris)"
DATA = "data.csv"
SOURCE = "Fisher 1936; summaries recomputed with numpy (see NOTES)"
NOTES = """\
Distribution summary of sepal_length over the 150-row Fisher iris dataset. These
are textbook descriptives for the variable.

Independent recompute (outside Iris, raw numpy):
    n = 150
    mean   = 5.843333   sd (ddof=1) = 0.828066
    median = 5.80   Q1 = 5.10   Q3 = 6.40
    min    = 4.3    max = 7.9
"""
SCHEMA_OVERRIDES = {}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": None, "y": {"column": "sepal_length"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "distribution", "params": {}}],
            "stats": {"alpha": 0.05},
        },
        "expected_stats": {
            "test": "descriptive",
            "n": 150,
            "mean": (5.843333, 1e-5),
            "sd": (0.828066, 1e-5),
            "median": (5.80, 1e-9),
            "q1": (5.10, 1e-9),
            "q3": (6.40, 1e-9),
            "min": (4.3, 1e-9),
            "max": (7.9, 1e-9),
        },
        "expected_model": {"family": "descriptive", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"x": "sepal length", "y": "Count"},
            "point_groups": 0,
            "min_patches": 8,                # histogram bars (+ chrome patches)
            "annotation_contains": "median",
        },
    },
]
