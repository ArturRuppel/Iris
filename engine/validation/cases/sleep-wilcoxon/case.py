"""Cushny–Peebles "sleep" data — the Wilcoxon signed-rank cell (paired, robust).

Same 10-patient paired data as ``sleep-paired-t``, but the user's nonparametric
paired choice: ``stats.override = "wilcoxon"``. Like its sibling it runs through the
paired-alignment path (``hierarchy.pairing`` → ``stats._paired_arrays``), aligning
one pair per patient (n = 10), and asserts the signed-rank W against an independent
recompute. See ``sleep-paired-t`` for the spine/pairing mechanics.
"""

TITLE = "Extra sleep by drug — Wilcoxon signed-rank (Cushny–Peebles)"
DATA = "data.csv"
SOURCE = ("Cushny & Peebles 1905; R datasets::sleep. Wilcoxon signed-rank "
          "recomputed with scipy.stats.wilcoxon / pingouin.wilcoxon (see NOTES)")
NOTES = """\
Same paired sleep data as sleep-paired-t (extra hours of sleep, 10 patients, two
drugs). The user picks the nonparametric paired test.

Independent recompute (outside Iris, raw scipy 1.16.3 / pingouin 0.6.1):
    scipy.stats.wilcoxon(drug1, drug2)
    -> W = 0.0, p = 0.00390625 ; n = 10 pairs
    pingouin.wilcoxon rank-biserial r (RBC) = -1.0

Every patient slept more under drug2 (all 10 signed differences are negative), so
the signed-rank statistic W = 0 and the rank-biserial effect is -1.0 (the sign is
the drug1 − drug2 direction, matching sleep-paired-t).
"""
SCHEMA_OVERRIDES = {
    "patient": {"identifier": True},
    "rep": {"identifier": True},
    "drug": {"type": "categorical", "levels": ["drug1", "drug2"]},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "hierarchy": {"spine": ["patient", "rep"], "fn": {}},
            "encodings": {"x": {"column": "drug"},
                          "y": {"column": "extra_sleep"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "stats": {"alpha": 0.05, "override": "wilcoxon"},
        },
        "expected_stats": {
            "test": "wilcoxon",
            "W": (0.0, 1e-9),
            "p": (0.00390625, 1e-9),
            "n": 10,                         # pairs, not 20 rows
            "effect.value": (-1.0, 1e-9),    # rank-biserial r
        },
        "expected_model": {"family": "group_comparison", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "extra sleep"},
            "xtick_labels": ["drug1", "drug2"],
            "point_groups": 0,               # box only — no per-point marks
        },
    },
]
