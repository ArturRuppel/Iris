"""Regression guard for the exclusion carve-out: filter-on-flag ≡ the removed
exclusion mechanism.

Iris used to carry a dedicated row-exclusion mechanism (an `excluded` bookkeeping
column + a `respect_exclusions` spec flag). It was removed because the general
`filter` reduce step already does the one thing it did — drop rows from an
analysis. This case proves the replacement is *equivalent*: a dataset with a
boolean `flag` column whose flagged rows are wild outliers, dropped via a normal
`reduce` `filter` step (`flag == False`), must reproduce exactly the stats the old
`respect_exclusions` would have produced on the un-flagged rows — asserted against
an independent scipy/pingouin recompute.

If the filter silently failed to drop the flagged rows, the outliers
(value 1000–1200 in control, −800/−900 in treatment) would swamp the comparison
and every number below would move, so this is a real guard, not a tautology.
"""

TITLE = "Filter-on-flag ≡ exclusion (control vs treatment)"
DATA = "data.csv"
SOURCE = "synthetic — known by construction; Welch's t recomputed with scipy (NOTES)"

NOTES = """\
20 rows: 8 clean + 2 flagged per group. The flagged rows are extreme outliers
(control 1000.0, 1200.0 ; treatment -800.0, -900.0) carrying flag = True; the
8 clean rows per group carry flag = False.

The reduce filter `flag == False` drops the four flagged rows, leaving the clean
two-group comparison:
    control:   10 12 14 16 18 20 22 24   (n = 8, mean = 17.0, exact)
    treatment: 22 24 26 28 30 32 34 36   (n = 8, mean = 29.0, exact)
    mean difference = -12.0              (exact)

Independent recompute (outside Iris, raw scipy 1.16.3 / pingouin) on the clean
rows — the rows the removed `respect_exclusions` would have kept:
    scipy.stats.ttest_ind(control, treatment, equal_var=False)
    -> t = -4.898979, df = 14.0, p = 2.3474e-04
    pingouin.compute_effsize(..., eftype="hedges") -> Hedges' g = -2.315881

The test is pinned to Welch's t (override) so the assertion is independent of the
small-sample selection heuristic.
"""
# `flag` is the boolean curation column the filter acts on (the exclusion
# replacement); `condition` is the categorical qualifier compared on x.
SCHEMA_OVERRIDES = {
    "condition": {"type": "categorical", "levels": ["control", "treatment"]},
    "flag": {"type": "bool"},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "condition"},
                          "y": {"column": "value"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "reduce": {"steps": [
                {"kind": "filter",
                 "conditions": [{"column": "flag", "op": "==", "value": False}]}]},
            "stats": {"alpha": 0.05, "chosen_by": "recommendation_accepted",
                      "test": "welch_t", "override": "welch_t"},
        },
        "expected_stats": {
            "test": "welch_t",
            "mean_diff": (-12.0, 1e-9),          # exact by construction
            "t": (-4.898979, 1e-4),
            "df": (14.0, 1e-9),
            "p": (0.00023474, 1e-6),
            "effect.value": (-2.315881, 1e-5),   # Hedges' g
            "summaries.0.n": 8,
            "summaries.1.n": 8,
            "summaries.0.mean": (17.0, 1e-9),
            "summaries.1.mean": (29.0, 1e-9),
        },
        "expected_model": {"family": "group_comparison", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "value"},
            "xtick_labels": ["control", "treatment"],
            "point_groups": 0,                   # box only — no per-point marks
        },
    },
]
