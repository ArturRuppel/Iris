"""Resolve aesthetic encodings into concrete scales the compiler draws from.

Each mapped channel (color / size / shape) becomes a lookup the per-point and
per-group geoms consult, plus a legend entry. Shape is categorical (one swatch
per level, in the schema's declared level order); size is continuous (numeric
value -> marker area); color is *either* — a categorical column resolves to a
discrete palette (one swatch per level) while a numeric column (Phase 3b)
resolves through a continuous colormap with a colorbar instead of swatches. When
a channel is unmapped, its lookup falls back to a single-series default so the
no-aesthetics path is unchanged.

This is the single source of truth shared by the geom render functions and the
legend, so a level always draws the same color/marker as its legend swatch.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .specutil import col_type, is_identifier

# The group/series palette — the single colour source of truth, shared by the
# geom render functions, the legend, the compiler (re-exported there), and the
# cardinality guard (guards.COLOR_CAP = len(PALETTE)). Leading 8 are Okabe–Ito
# (colourblind-safe); a plot with ≤8 series stays on them. Beyond that we extend
# with Paul Tol's qualitative hues (also colourblind-friendly) rather than
# wrapping back to colour 0, so 9+ series stay distinct. Black sits at index 7 so
# a single-series plot still leads with a coloured mark and the canonical
# 8-series look is unchanged. (Frontend mirror: state.ts DEFAULT_PALETTE.)
PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442",
           "#0072B2", "#D55E00", "#CC79A7", "#000000",
           "#332288", "#117733", "#88CCEE", "#882255",
           "#999933", "#AA4499", "#44AA99", "#661100"]

# marker area (pt²) at the min / max of a numeric size channel; chosen to read
# at thesis-figure mm sizes (small enough not to overlap, large enough to rank)
SIZE_MIN_AREA = 10.0
SIZE_MAX_AREA = 120.0

# categorical shape cycle; wraps past the end (a cardinality guard warns)
MARKERS = ["o", "s", "^", "D", "v", "P"]

# default continuous colormap for a numeric color channel: perceptually uniform
# and colourblind-safe, matching the Okabe–Ito ethos of the categorical palette.
COLOR_CMAP = "viridis"


def _levels(df: pd.DataFrame, schema: dict, name: str) -> list[str]:
    for c in schema["columns"]:
        if c["name"] == name and c.get("levels"):
            return list(c["levels"])
    return sorted(str(v) for v in df[name].dropna().unique())


def _col(enc: dict, key: str, present: set[str]) -> str | None:
    """The column a channel maps, but only if it survived into the current
    schema — a stale encoding referencing a dropped/reduced-away column is
    treated as unmapped (the guard pass surfaces it separately)."""
    e = enc.get(key)
    col = e["column"] if e and e.get("column") else None
    return col if col in present else None


@dataclass
class Scales:
    palette0: str                              # single-series fallback color
    color_col: str | None = None
    color_levels: list[str] = field(default_factory=list)
    _color_map: dict = field(default_factory=dict)
    # numeric color (Phase 3b): when the color column is numeric it resolves
    # through a continuous colormap (compiler passes c=values + cmap), not the
    # discrete palette. color_levels stays empty so per-point geoms don't split.
    color_numeric: bool = False
    color_lo: float = 0.0
    color_hi: float = 1.0
    color_cmap: str = COLOR_CMAP
    size_col: str | None = None
    size_lo: float = 0.0
    size_hi: float = 1.0
    shape_col: str | None = None
    shape_levels: list[str] = field(default_factory=list)

    @property
    def mapped(self) -> set[str]:
        s = set()
        if self.color_col is not None:
            s.add("color")
        if self.size_col is not None:
            s.add("size")
        if self.shape_col is not None:
            s.add("shape")
        return s

    def color_for(self, level) -> str:
        return self._color_map.get(str(level), self.palette0)

    def size_for(self, value) -> float:
        if self.size_col is None or self.size_hi == self.size_lo:
            return (SIZE_MIN_AREA + SIZE_MAX_AREA) / 2
        frac = (float(value) - self.size_lo) / (self.size_hi - self.size_lo)
        frac = min(1.0, max(0.0, frac))
        return SIZE_MIN_AREA + frac * (SIZE_MAX_AREA - SIZE_MIN_AREA)

    def marker_for(self, level) -> str:
        if self.shape_col is None:
            return MARKERS[0]
        i = self.shape_levels.index(str(level)) if str(level) in self.shape_levels else 0
        return MARKERS[i % len(MARKERS)]

    def colorbar_spec(self) -> dict | None:
        """For a numeric color channel, the colorbar the compiler draws in place
        of discrete swatches; None when color is unmapped or categorical."""
        if self.color_col is None or not self.color_numeric:
            return None
        return {"label": self.color_col, "vmin": self.color_lo,
                "vmax": self.color_hi, "cmap": self.color_cmap}

    def legend_entries(self) -> list[dict]:
        out: list[dict] = []
        # Item J: a discrete color and a shape mapping the SAME column collapse to
        # one combined block — each swatch carries both the color and the marker,
        # so the reader sees one row per label, not two redundant blocks. A numeric
        # color is a colorbar and can't fuse, so the shape stands alone there.
        merged = (self.color_col is not None and not self.color_numeric
                  and self.shape_col == self.color_col)
        # numeric color is a colorbar (colorbar_spec), not legend swatches
        if self.color_col is not None and not self.color_numeric:
            if merged:
                out.append({"channel": "color+shape", "label": self.color_col,
                            "swatches": [{"value": lv, "color": self._color_map[lv],
                                          "marker": self.marker_for(lv)}
                                         for lv in self.color_levels]})
            else:
                out.append({"channel": "color", "label": self.color_col,
                            "swatches": [{"value": lv, "color": self._color_map[lv]}
                                         for lv in self.color_levels]})
        if self.size_col is not None:
            ticks = sorted({self.size_lo, (self.size_lo + self.size_hi) / 2,
                            self.size_hi})
            out.append({"channel": "size", "label": self.size_col,
                        "swatches": [{"value": v, "size": self.size_for(v)}
                                     for v in ticks]})
        if self.shape_col is not None and not merged:
            out.append({"channel": "shape", "label": self.shape_col,
                        "swatches": [{"value": lv, "marker": self.marker_for(lv)}
                                     for lv in self.shape_levels]})
        return out


def resolve_scales(encodings: dict, df: pd.DataFrame, schema: dict,
                   style: dict) -> Scales:
    palette = style.get("palette") or ["#0e7490"]
    sc = Scales(palette0=palette[0])
    present = {c["name"] for c in schema["columns"]}

    color = _col(encodings, "color", present)
    if color:
        sc.color_col = color
        if col_type(schema, color) == "numeric" and not is_identifier(schema, color):
            # Phase 3b: continuous color. Normalize over the data range; the
            # compiler renders points with c=values + cmap and a colorbar. A
            # numeric *identifier* is a discrete key (superplot), not a colormap.
            vals = df[color].dropna().to_numpy(dtype=float)
            sc.color_numeric = True
            sc.color_lo = float(vals.min()) if len(vals) else 0.0
            sc.color_hi = float(vals.max()) if len(vals) else 1.0
        else:
            levels = _levels(df, schema, color)
            sc.color_levels = levels
            sc._color_map = {lv: palette[i % len(palette)]
                             for i, lv in enumerate(levels)}

    size = _col(encodings, "size", present)
    if size:
        vals = df[size].dropna().to_numpy(dtype=float)
        sc.size_col = size
        sc.size_lo = float(vals.min()) if len(vals) else 0.0
        sc.size_hi = float(vals.max()) if len(vals) else 1.0

    shape = _col(encodings, "shape", present)
    if shape:
        sc.shape_col = shape
        sc.shape_levels = _levels(df, schema, shape)

    return sc
