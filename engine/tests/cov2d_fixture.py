# engine/tests/cov2d_fixture.py
"""A synthetic COV2D §1-§2 stand-in and an independent recompute of the
notebook's paired_by_replicate, used to prove the absorbed graph matches.

Shape mirrors the report: a per-FRAME left table (cell_shape) and a per-CELL
right table (class_label). KEY = (experiment_id, position_id, cell_id). Each of
N=3 experiments has 2 positions; each position has 2 cells per class; each cell
has 3 frames (an odd, skewed count so the per-cell median != mean). class_label
is raw ("negative"/"positive") and is recoded to
("VimentinKO"/"NLS-mCherry") exactly as the notebook's CLASS_LABELS map does.
"""
from __future__ import annotations

import pandas as pd
import pingouin as pg
from scipy.stats import ttest_rel

KEY = ["experiment_id", "position_id", "cell_id"]
SPINE = ["experiment_id", "position_id", "cell_id", "frame"]
CLASS_MAP = {"negative": "VimentinKO", "positive": "NLS-mCherry"}
# group order must match the reference's (vk, nl) pairing below
LEVELS = ["VimentinKO", "NLS-mCherry"]

LEFT_SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
        {"name": "position_id", "type": "identifier", "label": "Position"},
        {"name": "cell_id", "type": "identifier", "label": "Cell"},
        {"name": "frame", "type": "identifier", "label": "Frame"},
        {"name": "value", "type": "numeric", "label": "Cell size"},
    ],
}

RIGHT_SCHEMA = {
    "schema_version": "1.0",
    "columns": [
        {"name": "experiment_id", "type": "identifier", "label": "Experiment"},
        {"name": "position_id", "type": "identifier", "label": "Position"},
        {"name": "cell_id", "type": "identifier", "label": "Cell"},
        {"name": "class_label", "type": "categorical", "label": "Class",
         "levels": ["negative", "positive"]},
    ],
}


def _build():
    """Deterministic rows: value = base(class) + experiment offset + a
    per-experiment class lift + small per-cell/frame wiggle. The lift widens the
    VimentinKO-vs-NLS gap differently per replicate, so the paired differences
    VARY across the N=3 experiments (a non-degenerate paired t: finite t, p<0.05)
    rather than being identical (which gives zero variance, t=inf). No RNG."""
    left_rows, right_rows, rid = [], [], 0
    base = {"negative": 100.0, "positive": 60.0}     # negative -> VimentinKO (higher)
    exp_gap = {"E1": 0.0, "E2": 6.0, "E3": 12.0}     # extra lift on 'negative' per experiment
    frame_w = {0: 0.0, 1: 1.0, 2: 5.0}   # skewed: per-cell median (1.0) != mean (2.0)
    for ei, exp in enumerate(["E1", "E2", "E3"]):
        exp_off = 5.0 * ei
        for pos in ["P1", "P2"]:
            for cls in ["negative", "positive"]:
                lift = exp_gap[exp] if cls == "negative" else 0.0
                for c in [0, 1]:
                    cell = f"{exp}_{pos}_{cls}_{c}"
                    right_rows.append({"experiment_id": exp, "position_id": pos,
                                       "cell_id": cell, "class_label": cls})
                    for fr in [0, 1, 2]:
                        rid += 1
                        wiggle = c * 2.0 + frame_w[fr]
                        left_rows.append({
                            "id": f"r{rid}", "experiment_id": exp,
                            "position_id": pos, "cell_id": cell, "frame": fr,
                            "value": base[cls] + exp_off + lift + wiggle})
    return pd.DataFrame(left_rows), pd.DataFrame(right_rows)


def left_table() -> dict:
    left, _ = _build()
    rows = left.to_dict(orient="records")
    return {"schema": LEFT_SCHEMA, "rows": rows}


def right_table() -> dict:
    _, right = _build()
    return {"schema": RIGHT_SCHEMA, "rows": right.to_dict(orient="records")}


def per_frame_reference() -> pd.DataFrame:
    """The notebook's per_frame_values: inner-merge label onto frames, recode."""
    left, right = _build()
    cls = right.copy()
    cls["class_label"] = cls["class_label"].map(CLASS_MAP).fillna(cls["class_label"])
    return left.merge(cls, on=KEY, how="inner")


def paired_by_replicate_reference(pf: pd.DataFrame | None = None,
                                  value: str = "value", agg: str = "median") -> dict:
    """The notebook's paired_by_replicate, recomputed from scratch."""
    if pf is None:
        pf = per_frame_reference()
    cell = pf.groupby([*KEY, "class_label"])[value].agg(agg).reset_index()
    field = cell.groupby(["experiment_id", "position_id", "class_label"])[value] \
                .agg(agg).reset_index()
    piv = field.groupby(["experiment_id", "class_label"])[value].agg(agg).unstack()
    vk = piv["VimentinKO"].to_numpy()
    nl = piv["NLS-mCherry"].to_numpy()
    tt = ttest_rel(vk, nl)
    g = float(pg.compute_effsize(vk, nl, paired=True, eftype="hedges"))
    return {"p": float(tt.pvalue), "t": float(tt.statistic), "g": g,
            "vk": vk.tolist(), "nl": nl.tolist(), "n": int(len(vk)),
            "piv": piv}
