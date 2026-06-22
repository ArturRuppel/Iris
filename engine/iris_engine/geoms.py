"""Geom registry — the single source of truth for composable layers.

Each geom declares the encodings it needs, whether it aggregates rows, its
default params, the param editors the frontend rail should render, and (for
per-row geoms) the point cap above which it cannot draw individually. The
compiler reads this to render, the guard pass reads it to validate, and the
frontend reads `registry_payload()` (served on /health) to build the rail.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Above this many raw marks, a per-row geom (dot/scatter) bloats the SVG: each
# point is still its own vector <use> node (~150 bytes), so payload grows with N.
# Dots are no longer individually clickable (item I removed the per-point
# point_groups/gid contract and its ~6k frontend listeners), so the old 3,000 cap
# — sized for interactive-node cost — can rise: a purely-vector scatter at 10,000
# points is ~1.5 MB with no per-point DOM wiring, which stays responsive.
POINT_CAP = 10000

# Phase 4: above this many facet cells (rows × cols, counting only combinations
# actually present in the data), the grid is unreadable and the per-cell SVG
# overhead becomes excessive. Blocking, like POINT_CAP.
FACET_CELL_CAP = 20


@dataclass(frozen=True)
class GeomDef:
    label: str
    family: str                       # group_comparison | correlation | descriptive
    aggregates: bool                  # collapses rows (bar/summary) vs per-row (dot)
    needs: list[str]                  # required encodings, e.g. ["x", "y"]
    # Phase 3: the column type each axis requires, so the *data* (not a stored
    # family) decides which geoms are offerable. "none" means the axis must be
    # absent (histogram/density have no x). `family` above is kept as a label the
    # stats engine reads; it no longer gates the UI — the type-match does.
    x_type: str = "categorical"       # "categorical" | "numeric" | "none"
    y_type: str = "numeric"           # "categorical" | "numeric" | "none"
    # Phase 3c: True on group-comparison geoms that render horizontally when
    # the encoding has numeric x + categorical y. Lets the offer rule surface
    # categorical columns on the Y channel and the gate rule enable these geoms
    # for the swapped orientation — no new geom keys, no UI rework.
    h_orient: bool = False
    point_cap: int | None = None      # blocking cap for per-row geoms
    aes: list[str] = field(default_factory=list)      # accepted aesthetic
    #   channels beyond x/y: per-point geoms take color/size/shape; group and
    #   aggregate geoms take a categorical color only (size/shape are ignored).


GEOMS: dict[str, GeomDef] = {
    "dot": GeomDef(
        "Dots", "group_comparison", False, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        point_cap=POINT_CAP, aes=["color", "size", "shape"]),
    "summary": GeomDef(
        "Mean ± error", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        aes=["color"]),
    "box": GeomDef(
        "Box", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        aes=["color"]),
    "violin": GeomDef(
        "Violin", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        aes=["color"]),
    "bar": GeomDef(
        "Bar ± error", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        aes=["color"]),
    # Estimate ± CI (item Q): one point per group with a model-derived CI bar.
    # Family group_comparison so it flows through build_comparison_figure like
    # `summary`; fed by the `rate` GLM when stats.family == "rate", else a plain
    # mean ± CI on the raw values (usable standalone).
    "pointrange": GeomDef(
        "Estimate ± CI", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        aes=["color"]),
    "scatter": GeomDef(
        "Scatter", "correlation", False, ["x", "y"],
        x_type="numeric", y_type="numeric",
        point_cap=POINT_CAP, aes=["color", "size", "shape"]),
    "regression": GeomDef(
        "Regression", "correlation", True, ["x", "y"],
        x_type="numeric", y_type="numeric",
        aes=["color"]),
    # Time series: numeric x (ordered) vs numeric y. `line` is per-unit
    # (spaghetti), `trend` is the aggregate (mean ± band). Both share the
    # `timeseries` family. Style knobs (alpha, linewidth, error_type, show_band)
    # live in the style registry (style.py), not here.
    "line": GeomDef(
        "Trajectories", "timeseries", aggregates=False, needs=["x", "y"],
        x_type="numeric", y_type="numeric",
        point_cap=POINT_CAP, aes=["color"]),
    "trend": GeomDef(
        "Mean ± band", "timeseries", aggregates=True, needs=["x", "y"],
        x_type="numeric", y_type="numeric",
        aes=["color"]),
    # Distribution of a single numeric column. Render mode, binning, and overlay
    # knobs live in the style registry (style.py).
    "distribution": GeomDef(
        "Distribution", "descriptive", True, ["y"],
        x_type="none", y_type="numeric"),
    # Tile/heatmap: categorical x × categorical y → fill = count. Colormap and
    # show_counts knobs live in the style registry (style.py).
    "tile": GeomDef(
        "Tile (heatmap)", "contingency", True, ["x", "y"],
        x_type="categorical", y_type="categorical"),
}


def registry_payload() -> dict:
    """JSON-safe registry for the frontend rail (served on /health)."""
    return {
        "point_cap": POINT_CAP,
        "facet_cell_cap": FACET_CELL_CAP,
        "geoms": {
            name: {"label": g.label, "family": g.family,
                   "aggregates": g.aggregates, "needs": list(g.needs),
                   "x_type": g.x_type, "y_type": g.y_type,
                   "h_orient": g.h_orient,
                   "point_cap": g.point_cap, "aes": list(g.aes)}
            for name, g in GEOMS.items()
        },
    }
