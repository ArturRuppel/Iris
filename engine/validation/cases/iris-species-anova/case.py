"""Petal length across all three species — the multi-group (omnibus) family.

The full 150-row Fisher iris, comparing petal_length across setosa / versicolor /
virginica. With >2 levels the engine runs a one-way ANOVA omnibus plus Tukey-HSD
pairwise comparisons; this case asserts the published ANOVA F against an
independent recompute, and that every pairwise contrast is drawn as a stacked
significance bracket.
"""

TITLE = "Petal length across species (Fisher's iris, one-way ANOVA)"
DATA = "data.csv"
SOURCE = "Fisher 1936; one-way ANOVA recomputed with scipy.stats.f_oneway (see NOTES)"
NOTES = """\
Published value: one-way ANOVA of petal_length ~ species on the 150-row Fisher
iris is a textbook figure (F = 1180.16).

Independent recompute (outside Iris, raw scipy 1.16.3):
    scipy.stats.f_oneway(setosa, versicolor, virginica)
    -> F = 1180.161182, p = 2.8567e-91 ; df = (2, 147), N = 150, k = 3
    partial η² (== η² for one-way) = 0.941437
    Tukey HSD (pingouin 0.6.1): every pairwise p-tukey < 1e-9 (all ***)

The engine *selects* ANOVA by inference (each species is large, n = 50, and
Shapiro-Wilk is consistent with within-group normality), so this also guards
multi-group test *selection*, not just the arithmetic. The robust sibling
(Kruskal-Wallis + Holm-adjusted Mann-Whitney) is reached via the override
channel and covered by the engine unit tests.
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
            "stats": {"alpha": 0.05},
        },
        "expected_stats": {
            "test": "one_way_anova",
            "F": (1180.161182, 1e-2),       # published Fisher-iris ANOVA F
            "p": ("<", 1e-80),              # p = 2.86e-91 (recomputed)
            "df_between": (2.0, 1e-9),
            "df_within": (147.0, 1e-9),
            "effect.value": (0.941437, 1e-4),   # η²
            "n": 150,
            "k": 3,
            "correction": "tukey",
            # every species pair differs (Tukey HSD); pairs are emitted in
            # combinatorial order (setosa<versicolor<virginica)
            "pairwise.0.stars": "***",
            "pairwise.1.stars": "***",
            "pairwise.2.stars": "***",
        },
        "expected_model": {"family": "group_comparison", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "petal length"},
            "xtick_labels": ["setosa", "versicolor", "virginica"],
            "point_groups": 0,              # box only — no per-point marks
        },
    },
]
