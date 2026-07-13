# engine/validation/cases/cov2d-tier-a/case.py
"""COV2D §1-§2 absorption — a cell-size SuperPlot built entirely inside Iris's
transformation graph: an inner join broadcasts a per-cell class label onto
per-frame rows, a recode relabels it, the default nested-median flatten chain
collapses frame->cell->position->experiment, and a paired t across N=3 replicates
+ Hedges g reproduces the notebook's paired_by_replicate. The right (class_label)
table embeds in the spec's join step; data.csv is the per-frame left table.
"""
TITLE = "COV2D Tier A — cell size SuperPlot (absorbed graph)"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped stand-in; reproduces the notebook's paired_by_replicate"

KEY = ["experiment_id", "position_id", "cell_id"]
SPINE = ["experiment_id", "position_id", "cell_id", "frame"]

# the per-cell class_label table, embedded inline in the join step (the corpus
# builds one CSV per case, so the second source rides in the spec)
RIGHT_TABLE = {
    "schema": {
        "schema_version": "1.0",
        "columns": [
            {"name": "experiment_id", "type": "categorical", "identifier": True, "label": "Experiment"},
            {"name": "position_id", "type": "categorical", "identifier": True, "label": "Position"},
            {"name": "cell_id", "type": "categorical", "identifier": True, "label": "Cell"},
            {"name": "class_label", "type": "categorical", "label": "Class",
             "levels": ["negative", "positive"]},
        ],
    },
    "rows": [
        {"experiment_id": e, "position_id": p, "cell_id": f"{e}_{p}_{cls}_{c}",
         "class_label": cls}
        for e in ["E1", "E2", "E3"] for p in ["P1", "P2"]
        for cls in ["negative", "positive"] for c in [0, 1]
    ],
}

SCHEMA_OVERRIDES = {
    "experiment_id": {"identifier": True},
    "position_id": {"identifier": True},
    "cell_id": {"identifier": True},
    "frame": {"identifier": True},
    "value": {"type": "numeric"},
}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.1",
            "title": TITLE,
            "data": {"filter": []},
            "reduce": {"steps": [
                {"kind": "filter",
                 "conditions": [{"column": "value", "op": "not-null"}]},
                {"kind": "join", "on": KEY, "how": "inner", "right": RIGHT_TABLE},
                {"kind": "recode", "column": "class_label",
                 "map": {"negative": "VimentinKO", "positive": "NLS-mCherry"}},
            ]},
            "encodings": {"x": {"column": "class_label"},
                          "y": {"column": "value"},
                          "color": {"column": "class_label"},
                          "size": None, "shape": None},
            "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
            "hierarchy": {"spine": SPINE, "fn": {lv: "median" for lv in SPINE}},
            "layers": [{"geom": "violin", "level": ""},
                       {"geom": "dot", "level": "cell_id"},
                       {"geom": "summary", "level": "experiment_id"}],
            "stats": {"alpha": 0.05, "override": "paired_t"},
        },
        "expected_stats": {
            "test": "paired_t",
            "n": 3,
            "p": (0.005623287315631087, 1e-9),
            "effect.value": (4.307114216817605, 1e-9),
        },
        "expected_model": {"family": "group_comparison"},
        "expected_figure": {
            "xtick_labels": ["VimentinKO", "NLS-mCherry"],
        },
    },
]
