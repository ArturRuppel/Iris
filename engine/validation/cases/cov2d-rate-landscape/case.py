# engine/validation/cases/cov2d-rate-landscape/case.py
"""COV2D §5 absorption (showcase) — an event-rate landscape built in the graph:
`derive` an absolute displacement, a data-dependent `filter` clips the tail at the
99th percentile of |L|, `grid_complete` builds the position × transition-type grid
(an absent combo is a real 0, not missing), and a final `derive` turns counts into
a rate. Smoke/visualization only — no pinned stats (describe-only)."""
import csv
from pathlib import Path

TITLE = "COV2D §5 — event-rate landscape (grid-completed, tail-clipped)"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

TT_LEVELS = ["static", "slow", "fast"]
EXPERIMENTS = ["E1", "E2", "E3"]
# events per (position, transition); (P3, fast) intentionally ABSENT so
# grid_complete must 0-fill it — the honest-zero-denominator point.
COUNTS = {
    ("P1", "static"): 5, ("P1", "slow"): 3, ("P1", "fast"): 2,
    ("P2", "static"): 4, ("P2", "slow"): 4, ("P2", "fast"): 3,
    ("P3", "static"): 6, ("P3", "slow"): 2,
}

SCHEMA_OVERRIDES = {
    "experiment_id": {"identifier": True},
    "position_id": {"identifier": True},
    "tt": {"type": "categorical", "levels": TT_LEVELS},
    "L": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {"steps": [
            {"kind": "derive", "column": "absL", "expr": "abs(L)"},
            {"kind": "filter", "conditions": [
                {"column": "absL", "op": "<=", "bound": "quantile(absL, 0.99)"}]},
            {"kind": "grid_complete", "by": ["experiment_id", "position_id"],
             "column": "tt", "levels": TT_LEVELS, "fill": 0, "count_name": "events"},
            {"kind": "derive", "column": "rate", "expr": "events / 60.0"},
        ]},
        "encodings": {"x": {"column": "tt"}, "y": {"column": "rate"},
                      "color": {"column": "tt"}, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": ["experiment_id", "position_id"],
                      "fn": {"experiment_id": "median", "position_id": "median"}},
        "layers": [{"geom": "box", "level": ""}],
        "stats": {"alpha": 0.05, "describe_only": True},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"xtick_labels": TT_LEVELS},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free → byte-stable gallery export)."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "tt", "L"])
        for e in EXPERIMENTS:
            for (pos, tt), n in COUNTS.items():
                for k in range(n):
                    w.writerow([e, pos, tt, round(1.0 + 0.1 * k, 3)])
        # two extreme-displacement events seed the tail; the 99th-percentile clip
        # removes the largest (120.0), leaving 99.0 — the cut is data-dependent
        w.writerow(["E1", "P1", "static", 99.0])
        w.writerow(["E2", "P2", "fast", 120.0])
