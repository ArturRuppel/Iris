"""Double-well potential by transition type — grouped distribution (item P).

A signed reaction coordinate with a clear double well (two Gaussian lobes at
±2), grouped by a 2-level transition type. Rendered as the Boltzmann
"potential" U(x) = −ln P with adaptive `sinh` bins (tighter near the x = 0
vertex) and the ΔE barrier annotation — the engine analogue of the COV2D
NLS-subpopulation report's hand-built T1 landscape (`t1_landscape_by_type.svg`).

Descriptive family, so there is no inferential test; the case guards the RENDER:
the two group curves overlay on one panel (shared bins), the y-axis reads the
log-density "−ln P", and the legend names both transition types. The pooled
descriptives below are an independent numpy recompute over all 320 rows.
"""

TITLE = "Double-well potential by transition type"
DATA = "data.csv"
SOURCE = ("Synthetic signed reaction coordinate (two Gaussian wells at ±2); "
          "pooled descriptives recomputed with numpy (see NOTES)")
NOTES = """\
320 rows: a signed reaction coordinate `coord` with a double well at ±2,
grouped by `state` (type A: 80/80 symmetric occupancy; type B: 110/50,
left-skewed → a deeper left well, hence a different effective barrier).

Independent recompute (outside Iris, raw numpy over all 320 pooled values):
    n = 320
    mean   = -0.385171   sd (ddof=1) = 2.019600
    median = -1.5188     Q1 = -2.109675   Q3 = 1.80645
    min    = -3.181      max = 3.6026

The figure is the Boltzmann potential U = −ln P per group, drawn over shared
sinh bins symmetric about 0, with the ΔE = U(0) − min U barrier labelled per
curve.
"""
SCHEMA_OVERRIDES = {
    "state": {"type": "categorical", "levels": ["type A", "type B"]},
    "coord": {"type": "numeric"},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "encodings": {"x": None, "y": {"column": "coord"},
                          "color": {"column": "state"},
                          "size": None, "shape": None},
            "layers": [{"geom": "distribution",
                        "params": {"dist_render": "potential",
                                   "bin_method": "sinh", "bin_sharpness": 3.0,
                                   "show_barrier": True}}],
            "style": {"overrides": {"reference_value": 0.0}},
            "stats": {"alpha": 0.05},
        },
        "expected_stats": {
            "test": "descriptive",
            "n": 320,
            "mean": (-0.385171, 1e-4),
            "sd": (2.019600, 1e-4),
            "median": (-1.5188, 1e-6),
        },
        "expected_model": {"family": "descriptive", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"x": "coord", "y": "−ln P"},
            "legend_labels": ["state", "type A", "type B"],   # title + 2 groups
            "point_groups": 0,             # potential draws lines, not scatter
        },
    },
]
