"""Synthetic three-group data — the nonparametric multi-group cell (Kruskal–Wallis).

The robust analogue of ``iris-species-anova``: the user picks ``kruskal``, which runs
the omnibus plus its Holm-adjusted pairwise Mann–Whitney contrasts. Synthetic, exact
by construction (no clean published nonparametric statistic exists). Three groups of
8, cleanly increasing, so every pairwise contrast is significant.
"""

TITLE = "Three-group comparison — Kruskal–Wallis (synthetic)"
DATA = "data.csv"
SOURCE = ("synthetic — known by construction; omnibus recomputed with "
          "scipy.stats.kruskal, pairwise with pingouin Mann–Whitney + Holm")
NOTES = """\
Three synthetic groups (n = 8 each), cleanly increasing:
    g1: 2.1 2.4 2.8 3.0 3.3 3.6 3.9 4.2
    g2: 4.0 4.4 4.8 5.1 5.4 5.7 6.0 6.3
    g3: 6.2 6.7 7.1 7.5 7.9 8.3 8.7 9.1

Independent recompute (outside Iris, raw scipy 1.16.3 / pingouin 0.6.1):
    scipy.stats.kruskal(g1, g2, g3)
    -> H = 19.845000, df = 2, p = 4.9058e-05 ; N = 24, k = 3
    epsilon² = (H - k + 1) / (N - k) = 0.849762
    Holm-adjusted pairwise Mann–Whitney: every pair p_adj < 0.001 (all ***)
        g1 vs g2: p_adj = 0.00062   g1 vs g3: p_adj = 0.00047
        g2 vs g3: p_adj = 0.00062

Pairs are emitted in combinatorial order (g1<g2<g3): pairwise.{0,1,2}.
"""
SCHEMA_OVERRIDES = {
    "group": {"type": "categorical", "levels": ["g1", "g2", "g3"]},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"respect_exclusions": True},
            "encodings": {"x": {"column": "group"},
                          "y": {"column": "value"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "stats": {"alpha": 0.05, "override": "kruskal"},
        },
        "expected_stats": {
            "test": "kruskal",
            "H": (19.845000, 1e-4),
            "df": (2.0, 1e-9),
            "p": ("<", 1e-4),                # p = 4.9e-05
            "n": 24,
            "k": 3,
            "correction": "holm",
            "effect.value": (0.849762, 1e-5),   # epsilon²
            "pairwise.0.stars": "***",
            "pairwise.1.stars": "***",
            "pairwise.2.stars": "***",
        },
        "expected_model": {"family": "group_comparison", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "value"},
            "xtick_labels": ["g1", "g2", "g3"],
            "point_groups": 0,               # box only — no per-point marks
        },
    },
]
