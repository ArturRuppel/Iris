"""Contact enrichment vs chance — the one-sample (location) family (item N).

Per contact type, log2(observed/expected) contact enrichment is tested against
**chance** (0): each group against its own null, not against another group. This
is the correct design when the groups are not mutually independent — the three
contact fractions sum to 1, so a between-group comparison would be partly
tautological (motivating the COV2D NLS-subpopulation figure).

The engine *infers* the test: 12 roughly-normal values per group (Shapiro–Wilk
consistent with normality, n ≥ the small-sample rule) yield the parametric
one-sample t — so this guards test *selection* as well as the arithmetic. The
figure draws a dashed reference line at 0 and one significance star per lane.
"""

TITLE = "Contact enrichment vs chance (one-sample location)"
DATA = "data.csv"
SOURCE = ("Synthetic log2 contact-enrichment values; one-sample t recomputed with "
          "scipy.stats.ttest_1samp (see NOTES)")
NOTES = """\
Three contact types, 12 per-replicate log2(observed/expected) enrichment values
each. Homotypic types are enriched (> 0), the heterotypic type is depleted (< 0),
and NLS-NLS sits near chance.

Independent recompute (outside Iris, raw scipy 1.16.3), each vs reference = 0:
    scipy.stats.ttest_1samp(values, 0.0)
    VimKO-VimKO: n = 12, mean =  0.699167, t =  17.083683, df = 11, p = 2.878e-09
    VimKO-NLS:   n = 12, mean = -0.500000, t = -17.058877, df = 11, p = 2.923e-09
    NLS-NLS:     n = 12, mean =  0.013333, t =   0.599625, df = 11, p = 5.609e-01
    Cohen's dz (mean(diff)/sd(diff)): 4.931634, -4.924474, 0.173097

NLS-NLS is the reference-centred null (p ≈ 0.56, not significant) — the honest
"does NOT differ from chance" verdict the design exists to express. The engine
selects the parametric one-sample t by inference (every group's Shapiro–Wilk is
consistent with normality and n = 12 is at/above the small-sample rule).
"""
SCHEMA_OVERRIDES = {
    "contact": {"type": "categorical",
                "levels": ["VimKO-VimKO", "VimKO-NLS", "NLS-NLS"]},
    "enrich": {"type": "numeric"},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "encodings": {"x": {"column": "contact"},
                          "y": {"column": "enrich"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "violin", "params": {}},
                       {"geom": "dot", "params": {}}],
            "stats": {"family": "location", "reference": 0.0, "alpha": 0.05},
        },
        "expected_stats": {
            "test": "one_sample_t",
            "reference": (0.0, 1e-12),
            # per group (declared level order), each vs chance = 0
            "per_group.0.level": "VimKO-VimKO",
            "per_group.0.t": (17.083683, 1e-4),
            "per_group.0.df": (11, 1e-9),
            "per_group.0.p": ("<", 1e-7),
            "per_group.0.effect.value": (4.931634, 1e-4),   # signed Cohen's dz
            "per_group.0.n": 12,
            "per_group.1.level": "VimKO-NLS",
            "per_group.1.t": (-17.058877, 1e-4),
            "per_group.1.effect.value": (-4.924474, 1e-4),
            "per_group.2.level": "NLS-NLS",
            "per_group.2.p": (">", 0.05),                   # centred on chance
            "per_group.2.stars": "ns",
            "summaries.0.n": 12,
            "summaries.0.mean": (0.699167, 1e-4),
        },
        "expected_model": {"family": "location", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "enrich"},
            "xtick_labels": ["VimKO-VimKO", "VimKO-NLS", "NLS-NLS"],
        },
    },
]
