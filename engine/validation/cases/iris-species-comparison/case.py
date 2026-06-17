"""Petal length, versicolor vs virginica — the two-group comparison family.

A reduce-filter drops setosa so the comparison is the two-group cell (Welch's t /
Mann-Whitney); the three-group omnibus sibling is iris-species-anova. The engine
*infers* the test: large, roughly-normal groups yield Welch's t, which this case
asserts.
"""

TITLE = "Petal length: versicolor vs virginica (Fisher's iris)"
DATA = "data.csv"
SOURCE = "Fisher 1936; Welch's t recomputed with scipy.stats.ttest_ind (see NOTES)"
NOTES = """\
The 150-row Fisher iris dataset, filtered (reduce step) to the two
non-trivially-separable species, comparing petal_length.

Independent recompute (outside Iris, raw scipy 1.16.3):
    scipy.stats.ttest_ind(versicolor, virginica, equal_var=False)
    -> t = -12.603779, df = 95.5704, p = 4.9003e-22
    versicolor: n = 50, mean = 4.2600 ; virginica: n = 50, mean = 5.5520
    mean difference = -1.2920

The engine selects Welch's t by inference (both groups large and Shapiro-Wilk
consistent with normality) — i.e. this also guards test *selection*, not just the
arithmetic.
"""
SCHEMA_OVERRIDES = {}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"respect_exclusions": True},
            "encodings": {"x": {"column": "species"},
                          "y": {"column": "petal_length"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "reduce": {"steps": [
                {"kind": "filter",
                 "conditions": [{"column": "species", "op": "in",
                                 "value": ["versicolor", "virginica"]}]}]},
            "stats": {"alpha": 0.05},
        },
        "expected_stats": {
            "test": "welch_t",
            "t": (-12.603779, 1e-4),
            "df": (95.5704, 1e-2),
            "p": ("<", 1e-18),                  # p = 4.9e-22
            "mean_diff": (-1.292, 1e-6),
            "effect.value": (-2.501415, 1e-4),  # Hedges' g
            "summaries.0.n": 50,
            "summaries.1.n": 50,
            "summaries.0.mean": (4.26, 1e-9),
            "summaries.1.mean": (5.552, 1e-9),
        },
        "expected_model": {"family": "group_comparison", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "petal length"},
            "xtick_labels": ["versicolor", "virginica"],
            "point_groups": 0,                  # box only — no per-point marks
        },
    },
]
