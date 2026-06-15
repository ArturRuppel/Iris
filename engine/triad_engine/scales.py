"""Resolve aesthetic encodings into concrete scales the compiler draws from.

Each mapped channel (color / size / shape) becomes a lookup the per-point and
per-group geoms consult, plus a legend entry. Color and shape are categorical
(one swatch per level, in the schema's declared level order); size is continuous
(numeric value -> marker area). When a channel is unmapped, its lookup falls
back to a single-series default so the no-aesthetics path is unchanged.

This is the single source of truth shared by the geom render functions and the
legend, so a level always draws the same color/marker as its legend swatch.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

# marker area (pt²) at the min / max of a numeric size channel; chosen to read
# at thesis-figure mm sizes (small enough not to overlap, large enough to rank)
SIZE_MIN_AREA = 10.0
SIZE_MAX_AREA = 120.0

# categorical shape cycle; wraps past the end (a cardinality guard warns)
MARKERS = ["o", "s", "^", "D", "v", "P"]


def _levels(df: pd.DataFrame, schema: dict, name: str) -> list[str]:
    for c in schema["columns"]:
        if c["name"] == name and c.get("levels"):
            return list(c["levels"])
    return sorted(str(v) for v in df[name].dropna().unique())


def _col(enc: dict, key: str) -> str | None:
    e = enc.get(key)
    return e["column"] if e and e.get("column") else None


@dataclass
class Scales:
    palette0: str                              # single-series fallback color
    color_col: str | None = None
    color_levels: list[str] = field(default_factory=list)
    _color_map: dict = field(default_factory=dict)
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

    def legend_entries(self) -> list[dict]:
        out: list[dict] = []
        if self.color_col is not None:
            out.append({"channel": "color", "label": self.color_col,
                        "swatches": [{"value": lv, "color": self._color_map[lv]}
                                     for lv in self.color_levels]})
        if self.size_col is not None:
            ticks = sorted({self.size_lo, (self.size_lo + self.size_hi) / 2,
                            self.size_hi})
            out.append({"channel": "size", "label": self.size_col,
                        "swatches": [{"value": v, "size": self.size_for(v)}
                                     for v in ticks]})
        if self.shape_col is not None:
            out.append({"channel": "shape", "label": self.shape_col,
                        "swatches": [{"value": lv, "marker": self.marker_for(lv)}
                                     for lv in self.shape_levels]})
        return out


def resolve_scales(encodings: dict, df: pd.DataFrame, schema: dict,
                   style: dict) -> Scales:
    palette = style.get("palette") or ["#0e7490"]
    sc = Scales(palette0=palette[0])

    color = _col(encodings, "color")
    if color:
        levels = _levels(df, schema, color)
        sc.color_col = color
        sc.color_levels = levels
        sc._color_map = {lv: palette[i % len(palette)]
                         for i, lv in enumerate(levels)}

    size = _col(encodings, "size")
    if size:
        vals = df[size].dropna().to_numpy(dtype=float)
        sc.size_col = size
        sc.size_lo = float(vals.min()) if len(vals) else 0.0
        sc.size_hi = float(vals.max()) if len(vals) else 1.0

    shape = _col(encodings, "shape")
    if shape:
        sc.shape_col = shape
        sc.shape_levels = _levels(df, schema, shape)

    return sc
