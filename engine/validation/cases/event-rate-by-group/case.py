"""Per-group event rate from a count GLM — the rate family (item Q).

Per treatment, a per-field event count with an imaging-time exposure offset is
modelled with a negative-binomial GLM: rate = exp(intercept), 95% CI =
exp(intercept ± z·SE), plus a global likelihood-ratio test for "does treatment
matter". This is the general per-group event-rate-with-exposure idiom (the COV2D
NLS-subpopulation report's hand-built T1-rate figure, `t1_rate_by_type.svg`).

Descriptive of the design: 3 treatments × 8 fields; counts are overdispersed, so
NB (not Poisson) is the honest model. Ground truth below is recomputed
independently against statsmodels — the first validation case needing it.
"""

TITLE = "Event rate by treatment (negative-binomial GLM)"
DATA = "data.csv"
SOURCE = ("Synthetic per-field event counts with an imaging-time exposure; "
          "rates + CIs + global LR recomputed with statsmodels (see NOTES)")
NOTES = """\
3 treatments × 8 fields; `events` counts per field, `hours` is the exposure
offset. Counts are negative-binomial (overdispersed), so the model is an NB GLM
of events ~ 1 with offset = log(hours), per group.

Independent recompute (outside Iris, raw statsmodels 0.14), per group:
    sm.NegativeBinomial(events, ones, offset=log(hours)).fit()
    rate = exp(intercept);  95% CI = exp(intercept ± 1.95996·SE)
    control:   n = 8, rate = 1.861800, CI (1.233103, 2.811039)
    inhibitor: n = 8, rate = 0.327640, CI (0.188173, 0.570476)
    activator: n = 8, rate = 3.575672, CI (2.160584, 5.917578)

Global likelihood-ratio test (events ~ C(treatment) vs ~ 1, NB, offset):
    LR χ²(2) = 22.776,  p = 1.133e-05  → treatment matters.
"""
SCHEMA_OVERRIDES = {
    "treatment": {"type": "categorical",
                  "levels": ["control", "inhibitor", "activator"]},
    "field": {"type": "identifier"},
    "events": {"type": "numeric"},
    "hours": {"type": "numeric"},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "encodings": {"x": {"column": "treatment"},
                          "y": {"column": "events"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "pointrange", "params": {}}],
            "stats": {"family": "rate", "exposure": "hours", "model": "nb",
                      "alpha": 0.05},
        },
        "expected_stats": {
            "test": "nb_glm",
            "p": ("<", 1e-4),                       # global LR — treatment matters
            "per_group.0.level": "control",
            "per_group.0.rate": (1.861800, 1e-4),
            "per_group.0.ci.0": (1.233103, 1e-4),
            "per_group.0.ci.1": (2.811039, 1e-4),
            "per_group.0.n": 8,
            "per_group.1.level": "inhibitor",
            "per_group.1.rate": (0.327640, 1e-4),
            "per_group.2.level": "activator",
            "per_group.2.rate": (3.575672, 1e-4),
            "per_group.2.ci.1": (5.917578, 1e-4),
            "summaries.2.mean": (3.575672, 1e-4),   # per-group rate, reader-shaped
        },
        "expected_model": {"family": "rate", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "rate (events / hours)"},   # groups named by xticks
            "xtick_labels": ["control", "inhibitor", "activator"],
            "point_groups": 0,                      # pointrange draws lines, not scatter
        },
    },
]
