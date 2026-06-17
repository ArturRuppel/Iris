"""Geom registry — the single source of truth for composable layers.

Each geom declares the encodings it needs, whether it aggregates rows, its
default params, the param editors the frontend rail should render, and (for
per-row geoms) the point cap above which it cannot draw individually. The
compiler reads this to render, the guard pass reads it to validate, and the
frontend reads `registry_payload()` (served on /health) to build the rail.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Above this many raw marks, a per-row geom (dot/scatter) freezes the browser:
# 82,241 points → a 13.8 MB SVG with 82k interactive <use> nodes. 1,383 points
# rendered in 0.26 MB and stayed responsive, so 3,000 is a safe blocking cap.
POINT_CAP = 3000

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
    params: dict = field(default_factory=dict)        # default param values
    param_specs: list[dict] = field(default_factory=list)  # frontend editors
    point_cap: int | None = None      # blocking cap for per-row geoms
    aes: list[str] = field(default_factory=list)      # accepted aesthetic
    #   channels beyond x/y: per-point geoms take color/size/shape; group and
    #   aggregate geoms take a categorical color only (size/shape are ignored).


def _num(key, label, *, lo, hi, step):
    return {"key": key, "label": label, "type": "number",
            "min": lo, "max": hi, "step": step}


def _err_select(key="error_type", label="Error bars"):
    return {"key": key, "label": label, "type": "select",
            "options": ["ci95", "sem", "sd"]}


def _sel(key, label, options):
    return {"key": key, "label": label, "type": "select", "options": list(options)}


def _bool(key, label):
    return {"key": key, "label": label, "type": "bool"}


# the distribution geom's render mode (how the single numeric column is drawn)
# and binning method (a numpy histogram_bin_edges strategy, or "fixed" → N bins).
DIST_RENDERS = ["bars", "step", "line", "points", "smooth", "potential"]
# "auto"/fd/scott/sturges/sqrt are numpy histogram_bin_edges strategies; "fixed"
# takes `hist_bins` bins; "sinh" places `hist_bins` bins tighter near x=0 (the
# null point of signed data — differences, log-ratios, contrasts), `bin_sharpness`
# controlling the concentration.
BIN_METHODS = ["auto", "fd", "scott", "sturges", "sqrt", "fixed", "sinh"]


GEOMS: dict[str, GeomDef] = {
    "dot": GeomDef(
        "Dots", "group_comparison", False, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        params={"layout": "swarm", "jitter": 0.18},
        param_specs=[_sel("layout", "Layout", ["swarm", "jitter"]),
                     _num("jitter", "Jitter", lo=0.0, hi=0.5, step=0.02),
                     _num("marker_size", "Point size", lo=4, hi=140, step=2),
                     _num("alpha", "Opacity", lo=0.05, hi=1.0, step=0.05)],
        point_cap=POINT_CAP, aes=["color", "size", "shape"]),
    "summary": GeomDef(
        "Mean ± error", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        params={"error_type": "ci95"},
        param_specs=[_err_select()], aes=["color"]),
    "box": GeomDef(
        "Box", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)],
        aes=["color"]),
    "violin": GeomDef(
        "Violin", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)],
        aes=["color"]),
    "bar": GeomDef(
        "Bar ± error", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric", h_orient=True,
        params={"error_type": "ci95"},
        param_specs=[_err_select()], aes=["color"]),
    "scatter": GeomDef(
        "Scatter", "correlation", False, ["x", "y"],
        x_type="numeric", y_type="numeric",
        params={},
        param_specs=[],
        point_cap=POINT_CAP, aes=["color", "size", "shape"]),
    "regression": GeomDef(
        "Regression", "correlation", True, ["x", "y"],
        x_type="numeric", y_type="numeric",
        params={}, param_specs=[], aes=["color"]),
    # Time series: numeric x (ordered, an ordered axis like `frame`) vs numeric y.
    # Two geoms mirror the dot+summary pairing — `line` is per-unit (the spaghetti
    # of one curve per spine unit), `trend` is the aggregate (mean ± band over
    # units per timepoint). Both share the `timeseries` family, which the engine's
    # geom-aware tie-break uses to claim a numeric/numeric design away from
    # `correlation` (see statmodel.infer). `color` styles *how* lines/trends look
    # per condition; for `line` "which rows form one curve" comes from the spine,
    # not an aesthetic (see hierarchy.trajectory_units).
    "line": GeomDef(
        "Trajectories", "timeseries", aggregates=False, needs=["x", "y"],
        x_type="numeric", y_type="numeric",
        params={"alpha": 0.35, "linewidth": 0.8},
        param_specs=[_num("alpha", "Opacity", lo=0.05, hi=1.0, step=0.05),
                     _num("linewidth", "Line width", lo=0.3, hi=3.0, step=0.1)],
        point_cap=POINT_CAP, aes=["color"]),
    "trend": GeomDef(
        "Mean ± band", "timeseries", aggregates=True, needs=["x", "y"],
        x_type="numeric", y_type="numeric",
        params={"error_type": "ci95", "show_band": True},
        param_specs=[_err_select(), _bool("show_band", "Spread band")],
        aes=["color"]),
    # one geom for the distribution of a single numeric column. `dist_render`
    # picks the representation (bars/step/line/points, or "smooth" = a KDE curve
    # with no bars — the old `density` geom). `overlay_smooth` adds a KDE on top
    # of a binned render; it is ignored when the render is already "smooth".
    # Binning: `bin_method` is a numpy strategy (fd/scott/sturges/sqrt/auto) or
    # "fixed", in which case `hist_bins` sets the count.
    #
    # descriptive geoms accept no aesthetic channels in Phase 2: a colored,
    # per-level overlay tangles with the single-series KDE and median
    # annotations, so it is deferred to a follow-up. Keeping aes empty means the
    # frontend never offers a channel the descriptive builder ignores.
    "distribution": GeomDef(
        "Distribution", "descriptive", True, ["y"],
        x_type="none", y_type="numeric",
        params={"dist_render": "bars", "bin_method": "auto"},
        param_specs=[_sel("dist_render", "Render", DIST_RENDERS),
                     _sel("bin_method", "Bins", BIN_METHODS),
                     _num("hist_bins", "Bin count (fixed/sinh)", lo=2, hi=200, step=1),
                     _num("bin_sharpness", "Sinh sharpness", lo=0.0, hi=8.0, step=0.5),
                     _bool("overlay_smooth", "Overlay smooth (KDE)")]),
    # Phase 3d: tile/heatmap geom — categorical x × categorical y → fill = count.
    # The one geom that makes categorical-vs-categorical worth offering; no
    # inferential test in 3d (chi-square is the natural follow-up in Tier 2).
    "tile": GeomDef(
        "Tile (heatmap)", "contingency", True, ["x", "y"],
        x_type="categorical", y_type="categorical",
        params={}, param_specs=[]),
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
                   "params": dict(g.params), "param_specs": list(g.param_specs),
                   "point_cap": g.point_cap, "aes": list(g.aes)}
            for name, g in GEOMS.items()
        },
    }
