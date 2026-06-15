"""Validity guards evaluated against the reduced data before render.

Phase 1 owns the *geom-level* guards — the new capability the grammar unlocks:
- per-row geoms (dot/scatter) that would draw more than POINT_CAP marks block
  the render (this is the 82k-point browser-freeze fix);
- box/violin with too few observations per group warn.

Model-level validity (too few per group, single-level factor) stays in
stats.py, which already returns those as 422s; we don't duplicate it here.
Each issue is {"level", "code", "message", "geom"}.
"""
from __future__ import annotations

import pandas as pd

from . import geoms

MIN_BOX_N = 3  # below this per group, a box/violin summary is meaningless


def _issue(level, code, message, geom=None):
    return {"level": level, "code": code, "message": message, "geom": geom}


def _xy(spec: dict):
    enc = spec["encodings"]
    x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
    y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
    return x, y


def evaluate(df: pd.DataFrame, schema: dict, spec: dict, stat_model) -> list[dict]:
    x, y = _xy(spec)
    issues: list[dict] = []
    for layer in spec.get("layers", []):
        name = layer["geom"]
        g = geoms.GEOMS.get(name)
        if g is None:
            continue

        if g.point_cap is not None:
            cols = [c for c in (x, y) if c and c in df]
            n = int(len(df[cols].dropna())) if cols else int(len(df))
            if n > g.point_cap:
                issues.append(_issue(
                    "blocking", "point_cap",
                    f"{n:,} points is too many to draw individually "
                    f"(limit {g.point_cap:,}). Add a Collapse step to "
                    f"aggregate, or use a summarizing geom (bar, box, violin).",
                    geom=name))

        if name in ("box", "violin") and x and y and x in df and y in df:
            sizes = df.dropna(subset=[y]).groupby(x)[y].size()
            if len(sizes) and int(sizes.min()) < MIN_BOX_N:
                issues.append(_issue(
                    "warning", "min_observations",
                    f"a group has fewer than {MIN_BOX_N} observations — the "
                    f"{name} summary is unreliable.", geom=name))
    return issues
