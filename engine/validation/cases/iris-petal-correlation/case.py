"""Petal length vs petal width on Fisher's iris — the correlation family."""

TITLE = "Petal length vs petal width (Fisher's iris)"
DATA = "data.csv"
SOURCE = "Fisher 1936; Pearson r recomputed with scipy.stats.pearsonr (see NOTES)"
NOTES = """\
Published value: Pearson r = 0.962865 between petal length and petal width on the
150-row Fisher iris dataset (a textbook figure).

Independent recompute (outside Iris, raw scipy 1.16.3):
    scipy.stats.pearsonr(petal_length, petal_width)
    -> r = 0.962865431, p = 4.6750e-86, n = 150

Test selection note: the engine *infers* Spearman here (Shapiro-Wilk rejects
normality on the petal dimensions, which are bimodal across species), so to
assert the published Pearson value we pin pearson via the user-override channel
(chosen_by = user_override). This case therefore validates Pearson correctness;
the engine's inference default (Spearman) is exercised elsewhere.
"""
SCHEMA_OVERRIDES = {}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"respect_exclusions": True},
            "encodings": {"x": {"column": "petal_length"},
                          "y": {"column": "petal_width"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "scatter", "params": {}},
                       {"geom": "regression", "params": {}}],
            "stats": {"alpha": 0.05, "chosen_by": "user_override",
                      "test": "pearson"},
        },
        "expected_stats": {
            "test": "pearson",
            "r": (0.962865, 1e-5),       # published Fisher-iris Pearson r
            "p": ("<", 1e-80),           # p = 4.7e-86 (recomputed)
            "n": 150,
        },
        "expected_model": {"family": "correlation", "chosen_by": "user_override"},
        "expected_figure": {
            "axis_labels": {"x": "petal length", "y": "petal width"},
            "n_points": 150,
            "point_groups": 1,
            "annotation_contains": "r =",   # the on-figure r/p readout
        },
    },
]
