# engine/validation/cases/cov2d-motility-superplot/case.py
"""COV2D §1–§2 absorption (showcase) — a motility SuperPlot whose unit of
inference is chosen, not enforced. The spine nests experiment›position›cell›frame;
`test_grain` explicitly routes the comparison to the experiment (replicate) grain
rather than letting the finest layer decide. Choosing a finer grain instead would
fire the pseudoreplication caution — the chapter shows that contrast in prose.
Smoke/visualization showcase (no pinned stats)."""
import csv
from pathlib import Path

TITLE = "COV2D §1–2 — motility SuperPlot, inference routed to the replicate"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

EXPERIMENTS = ["E1", "E2", "E3"]
POSITIONS = ["P1", "P2"]
CELLS = ["C1", "C2", "C3"]
FRAMES = [0, 1, 2]
CONDITIONS = ["ctrl", "trt"]
SPINE = ["experiment_id", "position_id", "cell_id", "frame"]
# trt speeds run higher than ctrl; per-experiment offset gives replicate spread
BASE = {"ctrl": 1.0, "trt": 1.6}
EXP_OFFSET = {"E1": 0.0, "E2": 0.1, "E3": -0.1}

SCHEMA_OVERRIDES = {
    "experiment_id": {"type": "identifier"},
    "position_id": {"type": "identifier"},
    "cell_id": {"type": "identifier"},
    "frame": {"type": "identifier"},
    "condition": {"type": "categorical", "levels": CONDITIONS},
    "speed": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {"steps": [
            {"kind": "filter",
             "conditions": [{"column": "speed", "op": "not-null"}]}]},
        "encodings": {"x": {"column": "condition"}, "y": {"column": "speed"},
                      "color": {"column": "condition"}, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": SPINE, "fn": {lv: "median" for lv in SPINE}},
        "test_grain": "experiment_id",
        "layers": [{"geom": "violin", "level": ""},
                   {"geom": "dot", "level": "cell_id"},
                   {"geom": "summary", "level": "experiment_id"}],
        "stats": {"alpha": 0.05, "override": "paired_t"},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"xtick_labels": CONDITIONS},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free). A small per-cell ramp gives
    intra-cell variation without randomness."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "cell_id", "frame",
                    "condition", "speed"])
        for e in EXPERIMENTS:
            for cond in CONDITIONS:
                base = BASE[cond] + EXP_OFFSET[e]
                for p in POSITIONS:
                    for ci, c in enumerate(CELLS):
                        cell = f"{e}_{p}_{cond}_{c}"
                        for fr in FRAMES:
                            speed = round(base + 0.05 * ci + 0.02 * fr, 4)
                            w.writerow([e, p, cell, fr, cond, speed])
