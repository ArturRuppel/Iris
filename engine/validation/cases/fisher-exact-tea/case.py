"""Fisher's lady-tasting-tea 2×2 — small-count contingency (Fisher's exact test).

The inverse of ``contingency-2x2``'s large table: tiny counts where the chi-square
approximation is unreliable, so the user picks Fisher's exact test. The reviewable
source is the cited count matrix (CELLS); the committed ``data.csv`` is the tidy
one-row-per-cup table generated from it. Regenerate with ``regenerate_data()``.
"""
import csv
from pathlib import Path

TITLE = "The lady tasting tea — Fisher's exact test (Fisher 1935)"
DATA = "data.csv"
SOURCE = ("Fisher, The Design of Experiments (1935); p recomputed with "
          "scipy.stats.fisher_exact (see NOTES)")

# The 2×2 of the lady's guess vs the actual preparation (milk-first vs tea-first):
# she was told 4 of 8 cups had milk poured first and correctly placed 3 of each.
CELLS = {("milk", "milk"): 3, ("milk", "tea"): 1,
         ("tea", "milk"): 1, ("tea", "tea"): 3}

NOTES = """\
Counts (rows = the lady's guess, cols = the actual preparation):
                actual_milk   actual_tea
    guess_milk       3            1
    guess_tea        1            3
n = 8 cups.

Independent recompute (outside Iris, raw scipy 1.16.3):
    scipy.stats.fisher_exact([[3,1],[1,3]])
    -> odds ratio = 9.0, two-sided p = 0.485714

Fisher's own one-sided hand computation gives p = 0.2429 (the probability of 3 or
more correct under the null); the engine reports scipy's *two-sided* p = 0.485714.
All expected cell counts are 2 (< 5), so this is exactly the small-count regime
where Fisher's exact, not chi-square, is the appropriate test.
"""
SCHEMA_OVERRIDES = {
    "guess": {"type": "categorical", "levels": ["milk", "tea"]},
    "actual": {"type": "categorical", "levels": ["milk", "tea"]},
}


def regenerate_data() -> None:
    """Rewrite data.csv from CELLS (deterministic; order is stable)."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["guess", "actual"])
        for (guess, actual), n in CELLS.items():
            for _ in range(n):
                w.writerow([guess, actual])


ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "actual"},
                          "y": {"column": "guess"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "tile", "params": {}}],
            "stats": {"alpha": 0.05, "override": "fisher_exact"},
        },
        "expected_stats": {
            "test": "fisher_exact",
            "p": (0.485714, 1e-5),           # scipy two-sided p
            "n": 8,
            "effect.value": (9.0, 1e-6),     # odds ratio
        },
        "expected_model": {"family": "contingency", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"x": "actual", "y": "guess"},
            "xtick_labels": ["milk", "tea"],
            "point_groups": 0,
        },
    },
]
