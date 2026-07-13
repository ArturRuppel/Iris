# engine/validation/cases/cov2d-shape-pivot/case.py
"""COV2D §4 absorption (showcase) — from long measurements to a shape factor. Each
cell contributes one row per measured feature (perimeter, area). A `pivot` unstacks
those into per-cell `perimeter`/`area` columns (long → wide), then a `derive`
computes the shape factor q = perimeter / sqrt(area) — pivot and derive composed.
Smoke/visualization showcase (no pinned stats)."""
import csv
from pathlib import Path

TITLE = "COV2D §4 — pivot to a shape factor, q = perimeter / sqrt(area)"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

EXPERIMENTS = ["E1", "E2", "E3"]
POSITIONS = ["P1", "P2"]
FEATURES = ["perimeter", "area"]
CLASSES = ["round", "spread"]
# per class: (perimeter, area) base — round cells are more compact (smaller q)
BASE = {"round": (40.0, 130.0), "spread": (60.0, 110.0)}

SCHEMA_OVERRIDES = {
    "experiment_id": {"identifier": True},
    "position_id": {"identifier": True},
    "cell_id": {"identifier": True},
    "class_label": {"type": "categorical", "levels": CLASSES},
    "feature": {"type": "categorical", "levels": FEATURES},
    "val": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {"steps": [
            {"kind": "pivot",
             "index": ["experiment_id", "position_id", "cell_id", "class_label"],
             "column": "feature", "values": "val", "agg": "mean", "fill": 0,
             "names": {"perimeter": "perimeter", "area": "area"}},
            {"kind": "derive", "column": "q", "expr": "perimeter / sqrt(area)"},
        ]},
        "encodings": {"x": {"column": "class_label"}, "y": {"column": "q"},
                      "color": {"column": "class_label"}, "size": None,
                      "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": [], "fn": {}},
        "layers": [{"geom": "box", "level": ""}],
        "stats": {"alpha": 0.05, "describe_only": True},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"xtick_labels": CLASSES},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free). Two feature rows per cell."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "cell_id", "class_label",
                    "feature", "val"])
        for e in EXPERIMENTS:
            for p in POSITIONS:
                for cls in CLASSES:
                    per, ar = BASE[cls]
                    for ci in range(3):
                        cell = f"{e}_{p}_{cls}_{ci}"
                        w.writerow([e, p, cell, cls, "perimeter", round(per + ci, 3)])
                        w.writerow([e, p, cell, cls, "area", round(ar + ci, 3)])
