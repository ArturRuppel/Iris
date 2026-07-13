"""Cushny–Peebles "sleep" data — the paired-t cell (and the paired-alignment path).

The classic 10-patient, two-soporific-drug dataset Student's 1908 paper used: each
patient's extra hours of sleep under two drugs. This is the *only* corpus case that
exercises the paired-alignment path — ``hierarchy.pairing`` detects ``patient`` as
the unit crossing both ``drug`` levels and ``stats._paired_arrays`` aligns one pair
per patient — so the engine reports n = 10 pairs, not 20 rows.

How the pairing unit reaches the engine: pairing runs over the spine levels
*coarser than* the comparison's home, and requires a finer spine entity that sees
both groups (see ``hierarchy.pairing`` / ``tests/test_paired.py``'s ``subject ⊃
rep`` design). So the spine is ``["patient", "rep"]`` — ``rep`` is the within-patient
matched-measurement index (each patient contributes one matched pair, rep = 1), and
``(patient, rep)`` crosses both drugs → pairing resolves to ``unit_cols = ["patient"]``.
"""

TITLE = "Extra sleep by drug — paired t (Cushny–Peebles 1905 / Student 1908)"
DATA = "data.csv"
SOURCE = ("Cushny & Peebles 1905; Student (Gosset) 1908; R datasets::sleep. "
          "Paired t recomputed with scipy.stats.ttest_rel / pingouin.ttest (see NOTES)")
NOTES = """\
Extra hours of sleep for 10 patients under two soporific drugs (the dataset of
Student's 1908 t-test paper; shipped as R's `datasets::sleep`):

    drug1: 0.7 -1.6 -0.2 -1.2 -0.1  3.4  3.7  0.8  0.0  2.0
    drug2: 1.9  0.8  1.1  0.1 -0.1  4.4  5.5  1.6  4.6  3.4

Independent recompute (outside Iris, raw scipy 1.16.3 / pingouin 0.6.1):
    scipy.stats.ttest_rel(drug1, drug2)
    -> t = -4.062128, df = 9, p = 0.0028329 ; n = 10 pairs
    mean difference (drug1 − drug2) = -1.58 ; Hedges' g = -0.797019

Sign note: the engine compares the levels in order (drug1 then drug2), so the
difference is drug1 − drug2 = -1.58 and t = -4.0621. The textbook often quotes the
magnitudes (1.58, 4.0621) for drug2 − drug1; the sign is just the comparison
direction, not a discrepancy.

The pairing is detected from the spine (`["patient", "rep"]`), NOT declared in the
stats block — `hierarchy.pairing` returns verdict "paired" across `patient`
(n_units = 10, n_complete = 10), so the engine aligns 10 pairs and counts n = 10.
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
            "stats": {"alpha": 0.05, "override": "paired_t"},
        },
        "expected_stats": {
            "test": "paired_t",
            "t": (-4.062128, 1e-5),
            "df": (9.0, 1e-9),
            "p": (0.0028329, 1e-6),          # p = 0.0028329
            "n": 10,                         # pairs, not 20 rows
            "mean_diff": (-1.58, 1e-9),
            "effect.value": (-0.797019, 1e-5),  # Hedges' g
        },
        "expected_model": {"family": "group_comparison", "chosen_by": "inferred"},
        "expected_figure": {
            "axis_labels": {"y": "extra sleep"},
            "xtick_labels": ["drug1", "drug2"],
            "point_groups": 0,               # box only — no per-point marks
        },
    },
]
