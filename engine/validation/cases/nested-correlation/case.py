"""Replicate-level correlation — the pseudoreplication guard for an association.

Nested data: 20 cells in each of 3 biological replicates. Within every replicate
the x–y association is strongly NEGATIVE, but the replicates are offset along a
positive diagonal, so POOLING all 60 cells manufactures a strong POSITIVE
correlation (ρ = +0.79, p ≈ 8e-14) — the correlation analogue of the SuperPlot
pseudoreplication trap. With the hierarchy spine set to `replicate`, Iris computes
the coefficient WITHIN each replicate and tests across the three (Fisher-z
one-sample t), recovering the honest negative association (mean ρ = -0.91, n = 3).
The spine makes correlation honour the replicate as the unit of inference, exactly
as the group-comparison / location / rate families already do.
"""

TITLE = "x vs y across biological replicates (nested)"
DATA = "data.csv"
SOURCE = ("Synthetic (seeded); pooled and replicate-level Spearman recomputed "
          "with scipy.stats.spearmanr / ttest_1samp (see NOTES).")
NOTES = """\
60 rows: 20 cells in each of 3 replicates (R1, R2, R3). Within-replicate slope is
negative; replicate offsets along a positive diagonal invert the pooled sign.

Independent recompute (raw scipy 1.16.3), x vs y:

    pooled, every cell (n=60)   Spearman rho = +0.788386, p = 7.58e-14
    per replicate rho           R1 -0.905263, R2 -0.884211, R3 -0.936842
    replicate-level (n=3)        rho = tanh(mean arctanh(rho)) = -0.911388
        Fisher-z one-sample t on arctanh(rho) vs 0:  p = 0.003657
        95% CI on rho            [-0.9592, -0.8127]

The point estimate is back-transformed from the Fisher-z mean — the same scale
the CI is computed on — so the estimate is the centre of its own interval (the
raw arithmetic mean of rho, -0.908772, is not).

The pooled and replicate-level coefficients have OPPOSITE signs — pooling cells is
not just an inflated n, it points the wrong way. The spine (replicate) is the
honest unit. Spearman is pinned via override so the assertion is independent of
the small-sample selection heuristic.
"""
SCHEMA_OVERRIDES = {"replicate": {"identifier": True}}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "x"}, "y": {"column": "y"},
                          "color": None, "size": None, "shape": None},
            "hierarchy": {"spine": ["replicate"], "fn": {}},
            "layers": [{"geom": "scatter", "params": {}},
                       {"geom": "regression", "params": {}}],
            "stats": {"alpha": 0.05, "chosen_by": "recommendation_accepted",
                      "test": "spearman", "override": "spearman"},
        },
        "expected_stats": {
            "result.test": "spearman",
            "result.n": 3,                       # the replicate is the unit, not 60 cells
            "result.r": (-0.911388, 1e-5),       # honest within-replicate association
            "result.p": (0.003657, 1e-4),
            "result.unit.0": "replicate",
        },
        "expected_model": {"family": "correlation", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"x": "x", "y": "y"},
            "n_points": 60,                      # every cell is still drawn
        },
    },
]
