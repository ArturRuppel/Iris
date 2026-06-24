"""Petal length vs petal width on Fisher's iris — the rank-correlation sibling.

The Spearman counterpart to ``iris-petal-correlation`` on the same two columns.
The petal relationship is monotonic but the columns are bimodal across species, so
a rank correlation is the natural user choice; the test is named via the override
channel (``stats.override = "spearman"``) and this case asserts that ρ is computed
correctly, not which test the engine would have inferred.
"""

TITLE = "Petal length vs petal width — Spearman (Fisher's iris)"
DATA = "data.csv"
SOURCE = "Fisher 1936; Spearman ρ recomputed with scipy.stats.spearmanr (see NOTES)"
NOTES = """\
Spearman rank correlation between petal length and petal width on the 150-row
Fisher iris dataset — the rank-based sibling of the Pearson case on the same data.

Independent recompute (outside Iris, raw scipy 1.16.3):
    scipy.stats.spearmanr(petal_length, petal_width)
    -> rho = 0.9376668, p = 8.1566e-70, n = 150

The p is less extreme than the Pearson case's (4.7e-86) because ranking discards
some of the linear signal — hence the looser operator bound below. The figure's
on-plot readout uses ρ (the Spearman symbol), not r.
"""
SCHEMA_OVERRIDES = {}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "petal_length"},
                          "y": {"column": "petal_width"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "scatter", "params": {}},
                       {"geom": "regression", "params": {}}],
            "stats": {"alpha": 0.05, "override": "spearman"},
        },
        "expected_stats": {
            "test": "spearman",
            "r": (0.9376668, 1e-6),      # ρ — recomputed scipy spearmanr
            "p": ("<", 1e-60),           # p = 8.16e-70 (recomputed)
            "n": 150,
        },
        "expected_model": {"family": "correlation", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"x": "petal length", "y": "petal width"},
            "n_points": 150,
            "point_groups": 1,
            "annotation_contains": "ρ =",   # Spearman's on-figure readout
        },
    },
]
