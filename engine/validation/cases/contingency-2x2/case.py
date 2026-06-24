"""Aspirin vs myocardial infarction — the contingency (chi-square) family.

The reviewable source is the cited 2x2 cell-count matrix (CELLS); the committed
``data.csv`` is the tidy one-row-per-subject table generated from it (Iris
consumes tidy tables, not count matrices). Regenerate with ``regenerate_data()``.
"""
import csv
from pathlib import Path

TITLE = "Aspirin vs myocardial infarction (Physicians' Health Study)"
DATA = "data.csv"
SOURCE = ("Steering Committee of the Physicians' Health Study Research Group, "
          "NEJM 1988 (the textbook 2x2, Agresti, Categorical Data Analysis); "
          "chi-square recomputed with scipy.stats.chi2_contingency (see NOTES)")

# The published 2x2 cell counts — the human-reviewable ground truth.
CELLS = {("aspirin", "MI"): 104,   ("aspirin", "no_MI"): 10933,
         ("placebo", "MI"): 189,   ("placebo", "no_MI"): 10845}

NOTES = """\
Cell counts (MI = myocardial infarction):
                MI     no_MI
    aspirin    104     10933
    placebo    189     10845

Independent recompute (outside Iris, raw scipy 1.16.3, no Yates correction):
    scipy.stats.chi2_contingency([[104,10933],[189,10845]], correction=False)
    -> chi2 = 25.013884, dof = 1, p = 5.6919e-07, n = 22071
    Cramer's V = 0.033665
All expected counts are large (min 146.5), so chi-square (not Fisher's exact) is
the engine's selected test for this 2x2.
"""
SCHEMA_OVERRIDES = {}


def regenerate_data() -> None:
    """Rewrite data.csv from CELLS (deterministic; order is stable)."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["group", "outcome"])
        for (group, outcome), n in CELLS.items():
            for _ in range(n):
                w.writerow([group, outcome])


ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "group"},
                          "y": {"column": "outcome"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "tile", "params": {}}],
            "stats": {"alpha": 0.05},
        },
        "expected_stats": {
            "test": "chi_square",
            "chi2": (25.013884, 1e-4),
            "dof": 1,
            "p": ("<", 1e-5),                 # p = 5.69e-07
            "n": 22071,
            "effect.value": (0.033665, 1e-5),  # Cramer's V
        },
        "expected_model": {"family": "contingency", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"x": "group", "y": "outcome"},
            "xtick_labels": ["aspirin", "placebo"],
            "point_groups": 0,
        },
    },
]
