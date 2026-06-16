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
from .scales import MARKERS

MIN_BOX_N = 3   # below this per group, a box/violin summary is meaningless
COLOR_CAP = 8   # the default Okabe–Ito palette length; above it, colors repeat

# Phase 3 "model now, build later" safeguard: the (channel, column-type) pairings
# the compiler cannot render TODAY, each with the reason shown to the user. Mapped
# channels matching one of these are warned about and dropped before render, so a
# saved .viz (or a column retyped after mapping) can never make the compiler draw,
# e.g., a continuous color it has no scale for yet. Kept in sync with the frontend
# support matrix (src/channels.ts); a later chunk flips an entry to renderable.
UNRENDERABLE: dict[tuple[str, str], str] = {
    # ("color", "numeric") is renderable as of Phase 3b (continuous colormap).
    ("shape", "numeric"): "shape can't encode a continuous value",
    ("size", "categorical"): "size encodes a numeric value, not categories",
}


def _issue(level, code, message, geom=None):
    return {"level": level, "code": code, "message": message, "geom": geom}


def _coltype(schema: dict, name: str | None) -> str | None:
    if not name:
        return None
    for c in schema["columns"]:
        if c["name"] == name:
            return c["type"]
    return None


def drop_unrenderable_channels(schema: dict, spec: dict) -> list[dict]:
    """Warn about and remove mapped aesthetic channels the compiler can't render
    yet (UNRENDERABLE). Mutates spec["encodings"] in place so the channel is
    absent from the draw context; returns the warnings raised."""
    enc = spec.get("encodings", {})
    out: list[dict] = []
    for ch in ("color", "size", "shape"):
        e = enc.get(ch)
        col = e["column"] if e and e.get("column") else None
        if not col:
            continue
        reason = UNRENDERABLE.get((ch, _coltype(schema, col)))
        if reason:
            out.append(_issue(
                "warning", "channel_unrenderable",
                f"{col} is mapped to {ch}, but {reason}. The {ch} channel is "
                f"ignored for now."))
            enc[ch] = None
    return out


def _xy(spec: dict):
    enc = spec["encodings"]
    x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
    y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
    return x, y


def evaluate(df: pd.DataFrame, schema: dict, spec: dict, stat_model) -> list[dict]:
    # stat_model is unused in Phase 1 — it's the deliberate seam for model-level
    # guards (facet multiplicity, etc.) that land in Phases 2-3.
    x, y = _xy(spec)
    # drop unrenderable aesthetic channels first, so the compiler never sees them
    # and they don't also trip the "channel ignored" / "palette exhausted" checks
    issues: list[dict] = drop_unrenderable_channels(schema, spec)
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

    issues.extend(_aesthetic_issues(df, schema, spec))
    return issues


def _aesthetic_issues(df: pd.DataFrame, schema: dict, spec: dict) -> list[dict]:
    """Phase 2: warn when an aesthetic channel has no effect (no layer accepts
    it) or exhausts its scale (more levels than colors/markers available)."""
    enc = spec["encodings"]
    accepted: set[str] = set()
    for layer in spec.get("layers", []):
        g = geoms.GEOMS.get(layer["geom"])
        if g:
            accepted |= set(g.aes)

    out: list[dict] = []
    for ch in ("color", "size", "shape"):
        e = enc.get(ch)
        col = e["column"] if e and e.get("column") else None
        if not col:
            continue
        if ch not in accepted:
            out.append(_issue(
                "warning", "channel_ignored",
                f"{col} is mapped to {ch}, but no current layer draws {ch} — "
                f"it has no effect. Add a geom that uses it, or clear the "
                f"mapping."))
            continue
        # a numeric color is a continuous colorbar (Phase 3b), not a palette —
        # it can't "exhaust" a discrete set, so skip the cardinality check.
        if ch == "color" and _coltype(schema, col) == "numeric":
            continue
        if ch in ("color", "shape") and col in df:
            n = int(df[col].dropna().astype(str).nunique())
            cap = COLOR_CAP if ch == "color" else len(MARKERS)
            if n > cap:
                kind = "colors" if ch == "color" else "marker shapes"
                out.append(_issue(
                    "warning", "palette_exhausted",
                    f"{col} has {n} levels but only {cap} {kind} are "
                    f"available — they repeat. Consider faceting instead."))
    return out
