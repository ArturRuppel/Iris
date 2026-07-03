"""Rank-floor guard at N = 3 replicates — the one-sample (location) family (item R).

The motivating bug: the COV2D §3 contact-enrichment plot is run at N = 3
biological replicates, one-sample-vs-chance. Iris's small-sample rule
(n < 12 → robust) would recommend the Wilcoxon signed-rank test — but at n = 3 the
signed-rank test is DEGENERATE: its smallest attainable two-sided p is 2/2³ = 0.25,
so it can never reach α = 0.05 no matter what the data say. Recommending it there
hands the user a test that, by construction, can never reject.

This case pins the fix: at n = 3 the engine must NOT recommend the rank test. It
falls back to the parametric one-sample t (whose normality assumption is
unverifiable at this n, stated in the reason), which CAN resolve — the two
clearly-enriched lanes star, while the chance-centred lane stays n.s. Under the
old (buggy) recommendation all three lanes would have read n.s.

Ground truth recomputed independently with raw scipy (never echoing Iris) — see
NOTES. The rank-floor arithmetic (2/2ⁿ) is documented in
docs/guide/troubleshooting.md and by GraphPad Prism (FAQ 1684), which reports the
floor rather than recommending the test at this N.
"""

TITLE = "Contact enrichment vs chance at N = 3 (rank-floor guard)"
DATA = "data.csv"
SOURCE = ("Synthetic log2 contact-enrichment values at N = 3 replicates; one-sample t "
          "recomputed with scipy.stats.ttest_1samp (see NOTES). Rank floor: GraphPad "
          "Prism FAQ 1684.")
NOTES = """\
Three contact types, 3 per-replicate log2(observed/expected) enrichment values
each (the small-N replicate design this lab actually runs). Two homotypic types
are enriched/depleted away from chance; NLS-NLS sits near chance (0).

Signed-rank floor at n = 3: smallest attainable two-sided p = 2/2³ = 0.25 > 0.05
→ the Wilcoxon signed-rank test can NEVER reject here. The engine must therefore
recommend the parametric one-sample t instead (item R guard).

Independent recompute (outside Iris, raw scipy 1.16.x), each vs reference = 0:
    scipy.stats.ttest_1samp(values, 0.0)
    VimKO-VimKO: n = 3, mean =  0.800000, t =  17.320508, df = 2, p = 3.3168e-03
    VimKO-NLS:   n = 3, mean = -0.630000, t = -14.453191, df = 2, p = 4.7530e-03
    NLS-NLS:     n = 3, mean =  0.016667, t =   0.492665, df = 2, p = 6.7102e-01
    Cohen's dz (mean(diff)/sd(diff)): 10.000000, -8.344554, 0.284440

Both homotypic lanes are significant under the one-sample t (p < 0.05); NLS-NLS is
not (the honest "does NOT differ from chance" verdict). The recommended test is
one_sample_t (NOT wilcoxon_signed): the guard fires because the rank floor (0.25)
exceeds α.
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
            "layers": [{"geom": "dot", "params": {}}],
            "stats": {"family": "location", "reference": 0.0, "alpha": 0.05},
        },
        "expected_stats": {
            # the guard fired: parametric t recommended, NOT the rank test
            "recommendation.test": "one_sample_t",
            "decision.assumption.recommended": "parametric",
            "test": "one_sample_t",
            "reference": (0.0, 1e-12),
            "per_group.0.level": "VimKO-VimKO",
            "per_group.0.t": (17.320508, 1e-4),
            "per_group.0.df": (2, 1e-9),
            "per_group.0.p": ("<", 0.05),               # resolves — the whole point
            "per_group.0.stars": "**",
            "per_group.0.effect.value": (10.0, 1e-4),   # signed Cohen's dz
            "per_group.0.n": 3,
            "per_group.1.level": "VimKO-NLS",
            "per_group.1.t": (-14.453191, 1e-4),
            "per_group.1.p": ("<", 0.05),
            "per_group.2.level": "NLS-NLS",
            "per_group.2.p": (">", 0.05),               # centred on chance
            "per_group.2.stars": "ns",
        },
        "expected_model": {"family": "location", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "enrich"},
            "xtick_labels": ["VimKO-VimKO", "VimKO-NLS", "NLS-NLS"],
        },
    },
]
