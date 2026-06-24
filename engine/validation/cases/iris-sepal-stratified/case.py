"""Stratified correlation — sepal length vs width PER species (Fisher's iris).

The textbook Simpson's paradox: pooled across the three species, sepal length and
width are slightly NEGATIVELY associated (r = -0.12, n.s.); but WITHIN every
species the association is clearly POSITIVE (setosa +0.74, versicolor +0.53,
virginica +0.46). A single pooled coefficient is therefore actively misleading.
When a categorical colour (species) is on a correlation, Iris computes one
coefficient per group — the `per_group` contract — and draws a regression line +
readout per species, so the within-group structure the pooled number hides is
read straight off the figure.
"""

TITLE = "Sepal length vs width, by species (Fisher's iris)"
DATA = "data.csv"
SOURCE = ("Fisher 1936; pooled and per-species Pearson r recomputed with "
          "scipy.stats.pearsonr (see NOTES).")
NOTES = """\
Independent recompute (raw scipy 1.16.3), sepal_length vs sepal_width:

    pooled (n=150)          r = -0.117570, p = 0.151898   (slightly NEGATIVE)
    setosa     (n=50)       r = +0.742547, p = 6.71e-10
    versicolor (n=50)       r = +0.525911, p = 8.77e-05
    virginica  (n=50)       r = +0.457228, p = 8.43e-04

This is Simpson's paradox: the pooled sign is the OPPOSITE of every within-group
sign, because the species differ in both mean sepal length and width. The
stratified correlation (one coefficient per species) is the honest read.

Pearson is pinned via the override channel so the assertion targets the published
Pearson values; chosen_by stays neutral (the user owns the pick). per_group order
follows the data's species order: setosa, versicolor, virginica.
"""
SCHEMA_OVERRIDES = {"species": {"type": "categorical",
                                "levels": ["setosa", "versicolor", "virginica"]}}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "sepal_length"},
                          "y": {"column": "sepal_width"},
                          "color": {"column": "species"},
                          "size": None, "shape": None},
            "layers": [{"geom": "scatter", "params": {}},
                       {"geom": "regression", "params": {}}],
            "stats": {"alpha": 0.05, "chosen_by": "recommendation_accepted",
                      "test": "pearson", "override": "pearson"},
        },
        "expected_stats": {
            # pooled (group-agnostic) stays the top-level result — and is negative
            "result.test": "pearson",
            "result.r": (-0.117570, 1e-5),
            # the per-group coefficients: all positive, one per species
            "per_group.0.level": "setosa",
            "per_group.0.r": (0.742547, 1e-5),
            "per_group.0.p": ("<", 1e-9),
            "per_group.0.n": 50,
            "per_group.1.level": "versicolor",
            "per_group.1.r": (0.525911, 1e-5),
            "per_group.2.level": "virginica",
            "per_group.2.r": (0.457228, 1e-5),
        },
        "expected_model": {"family": "correlation", "chosen_by": "inferred"},
        "expected_figure": {
            # discrete colour is one vectorised scatter call (not per-group
            # collections), so all 150 points sit in a single point group; the
            # 3-way stratification is asserted in expected_stats (per_group) and
            # drawn as one regression line + readout per species.
            "axis_labels": {"x": "sepal length", "y": "sepal width"},
            "n_points": 150,
        },
    },
]
