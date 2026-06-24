# engine/validation/cases/cov2d-enrichment/case.py
"""COV2D §3 absorption (showcase) — a post-collapse enrichment. Per-cell obs/exp
counts sum up the spine to the experiment grain (collapse fn = sum), then a
`reduce.post` `derive` computes log2(Σobs / Σexp) ON the aggregated rows — a
grain-dependent transform the raw-grain reduce phase cannot express. The
one-sample `location` test asks whether replicate enrichment differs from 0; the
post-aggregate-derive caution guard fires (derive after an aggregate). Smoke
showcase — the test runs but no number is pinned."""
import csv
from pathlib import Path

TITLE = "COV2D §3 — replicate enrichment, log2(Σobs/Σexp) after collapse"
DATA = "data.csv"
SOURCE = "synthetic COV2D-shaped; smoke/visualization showcase (no pinned stats)"

EXPERIMENTS = ["E1", "E2", "E3"]
POSITIONS = ["P1", "P2"]
CELLS = ["C1", "C2", "C3"]
# per-experiment obs:exp ratio (varied so replicate enrichment has nonzero spread,
# else a one-sample t over identical values is degenerate)
RATIO = {"E1": 2.0, "E2": 2.2, "E3": 1.8}

SCHEMA_OVERRIDES = {
    "experiment_id": {"type": "identifier"},
    "position_id": {"type": "identifier"},
    "cell_id": {"type": "identifier"},
    "contact": {"type": "categorical", "levels": ["high"]},
    "obs": {"type": "numeric"},
    "exp": {"type": "numeric"},
}

ANALYSES = [{
    "spec": {
        "spec_version": "2.1",
        "title": TITLE,
        "data": {"filter": []},
        "reduce": {
            "steps": [],
            "post": [{"kind": "derive", "column": "enrich",
                      "expr": "log2(obs / exp)"}],
        },
        "encodings": {"x": {"column": "contact"}, "y": {"column": "enrich"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": ["experiment_id", "position_id", "cell_id"],
                      "fn": {"experiment_id": "sum", "position_id": "sum",
                             "cell_id": "sum"}},
        "test_grain": "experiment_id",
        "layers": [{"geom": "dot", "level": "experiment_id"},
                   {"geom": "summary", "level": "experiment_id"}],
        "stats": {"family": "location", "reference": 0.0, "alpha": 0.05},
    },
    "expected_stats": {},
    "expected_model": {},
    "expected_figure": {"axis_labels": {"y": "enrich"}},
}]


def regenerate_data() -> None:
    """Rewrite data.csv deterministically (RNG-free)."""
    path = Path(__file__).parent / DATA
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["experiment_id", "position_id", "cell_id", "contact",
                    "obs", "exp"])
        for e in EXPERIMENTS:
            r = RATIO[e]
            for p in POSITIONS:
                for ci, c in enumerate(CELLS):
                    exp = 10 + ci          # 10, 11, 12 — deterministic
                    obs = round(exp * r)   # ratio sets the enrichment per replicate
                    w.writerow([e, p, c, "high", obs, exp])
