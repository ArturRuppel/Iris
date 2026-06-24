"""Array-shape descriptor for a materialized node frame (display lens only).

A tidy frame is the COO encoding of a labeled array: identifier columns are AXES,
measured columns are VALUES. These functions read that shape off a frame the engine
has already materialized — no change to how reductions compute. Pandas-only.
"""
from __future__ import annotations

import pandas as pd

_META = ("id", "row_ids")


def _present_spine(frame: pd.DataFrame, spine: list[str]) -> list[str]:
    """Spine columns actually in this frame, in spine (coarsest->finest) order."""
    return [s for s in spine if s in frame.columns]


def value_grain(frame: pd.DataFrame, spine: list[str], value: str) -> str | None:
    """Coarsest spine prefix on which `value` is constant within every group.

    Walk prefixes coarsest->finest; the native grain is the deepest axis of the
    first (shallowest) prefix where the value is constant within each group.
    Returns None when the value only becomes constant at the row grain — i.e. once
    a prefix already separates every row, constancy there is trivial (each group is
    a singleton), so there is no meaningful coarser grain to tag.
    """
    present = _present_spine(frame, spine)
    n = len(frame)
    for i in range(len(present)):
        prefix = present[: i + 1]
        g = frame.groupby(prefix, observed=True)
        if g.ngroups >= n:
            # this prefix fully separates rows and no coarser prefix was constant:
            # the value lives at the row grain -> no tag.
            return None
        if g[value].nunique(dropna=False).max() <= 1:
            return present[i]
    return None
