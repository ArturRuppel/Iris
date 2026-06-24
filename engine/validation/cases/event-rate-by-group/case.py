"""Per-group event rate from a count GLM — the rate family (item Q).

Per treatment, a per-field event count with an imaging-time exposure offset is
modelled with a negative-binomial GLM: rate = exp(intercept), 95% CI =
exp(intercept ± z·SE), plus a global likelihood-ratio test for "does treatment
matter". This is the general per-group event-rate-with-exposure idiom (the COV2D
NLS-subpopulation report's hand-built T1-rate figure, `t1_rate_by_type.svg`).

Descriptive of the design: 3 treatments × 8 fields; counts are overdispersed, so
NB (not Poisson) is the honest model. Iris fits the NB GLM with statsmodels, so
the corpus does not pin rates/CIs/LR — that would be statsmodels-vs-statsmodels.
"""

TITLE = "Event rate by treatment (negative-binomial GLM)"
DATA = "data.csv"
SOURCE = "Synthetic per-field event counts with an imaging-time exposure (see NOTES)"
NOTES = """\
3 treatments × 8 fields; `events` counts per field, `hours` is the exposure
offset. Counts are negative-binomial (overdispersed), so the model is an NB GLM
of events ~ 1 with offset = log(hours), per group.

Iris fits this with statsmodels (sm.NegativeBinomial), so the corpus does not
assert the resulting rates/CIs/LR — recomputing them with statsmodels would just
be statsmodels-vs-statsmodels. It asserts the model wiring, the group labels and
the by-construction group size, plus the figure.
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
            "per_group.0.level": "control",
            "per_group.0.n": 8,
            "per_group.1.level": "inhibitor",
            "per_group.2.level": "activator",
        },
        "expected_model": {"family": "rate", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "rate (events / hours)"},   # groups named by xticks
            "xtick_labels": ["control", "inhibitor", "activator"],
            "point_groups": 0,                      # pointrange draws lines, not scatter
        },
    },
]
