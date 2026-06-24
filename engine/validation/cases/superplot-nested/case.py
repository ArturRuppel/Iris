"""A SuperPlot: nested replicates, with inference at the biological-replicate
grain — the pseudoreplication guard (Lord et al. 2020).

Three cells (technical replicates) measured in each of three subjects
(biological replicates) per group. The SuperPlot is composed as layers bound to
different grains: faint dots for every cell (raw) and bold dots coloured by
subject for each biological replicate (the `subject` level). Because the
prominent dots are bound to `subject`, Iris runs the comparison on the THREE
subject means per group — n = 3, not n = 9 — so pseudoreplicating over cells
can't inflate significance. The test is pinned to Welch's t so the assertion is
independent of the small-sample selection heuristic; t/df/p are recomputed from
the known subject means.
"""

TITLE = "Drug effect across biological replicates (SuperPlot)"
DATA = "data.csv"
SOURCE = ("Synthetic; SuperPlot pattern after Lord, Velle, Mullins & Fritz-Laylin "
          "(2020) J Cell Biol 219(6):e202001064. Welch's t recomputed with scipy.")
NOTES = """\
Two groups (ctrl, drug), three subjects each, three cells per subject = 18 rows.
The three per-subject cell offsets [-0.2, 0, +0.2] sum to zero, so each subject
mean is exact:
    ctrl subjects: 10.0, 11.0, 12.0  (group mean 11.0)
    drug subjects: 13.0, 14.0, 15.0  (group mean 14.0)
    mean difference = -3.0 (exact)

The hierarchy spine is `subject` (cells nest in subjects); the bold dot and
summary layers are bound to `subject`, so the comparison runs on the subject
means (n = 3 per group), NOT the 18 raw cells. This is the SuperPlot's purpose:
show the cell-level spread while testing at the replicate grain.

Independent recompute (raw scipy 1.16.3) on the subject means:
    scipy.stats.ttest_ind([10,11,12], [13,14,15], equal_var=False)
    -> t = -3.674235, df = 4.0, p = 2.1312e-02
"""
SCHEMA_OVERRIDES = {"subject": {"type": "categorical"}}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": {"column": "group"},
                          "y": {"column": "value"},
                          "color": {"column": "subject"},
                          "size": None, "shape": None},
            "hierarchy": {"spine": ["subject"], "fn": {}},
            "layers": [
                {"geom": "dot", "params": {}, "level": ""},
                {"geom": "dot", "params": {}, "level": "subject"},
            ],
            "reduce": {"steps": []},
            "stats": {"alpha": 0.05, "chosen_by": "recommendation_accepted",
                      "test": "welch_t", "override": "welch_t"},
        },
        "expected_stats": {
            "test": "welch_t",
            "mean_diff": (-3.0, 1e-9),          # exact by construction
            "t": (-3.674235, 1e-4),
            "df": (4.0, 1e-9),
            "p": ("<", 0.05),                   # p = 2.13e-02
            "summaries.0.n": 3,                 # 3 subjects, NOT 9 cells
            "summaries.1.n": 3,
            "summaries.0.mean": (11.0, 1e-9),
            "summaries.1.mean": (14.0, 1e-9),
        },
        "expected_model": {"family": "group_comparison",
                           "chosen_by": "inferred",
                           "inferential_level": "subject"},
        "expected_figure": {
            "axis_labels": {"y": "value"},
            "xtick_labels": ["ctrl", "drug"],
            "n_points": 24,                     # 18 cells (raw) + 6 subject dots
        },
    },
]
