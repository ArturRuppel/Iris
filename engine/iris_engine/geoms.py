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


GEOMS: dict[str, GeomDef] = {
    "dot": GeomDef(
        "Dots", "group_comparison", False, ["x", "y"],
        x_type="categorical", y_type="numeric",
        params={"jitter": 0.18},
        param_specs=[_num("jitter", "Jitter", lo=0.0, hi=0.5, step=0.02)],
        point_cap=POINT_CAP, aes=["color", "size", "shape"]),
    "summary": GeomDef(
        "Mean ± error", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric",
        params={"error_type": "ci95"},
        param_specs=[_err_select()], aes=["color"]),
    "box": GeomDef(
        "Box", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric",
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)],
        aes=["color"]),
    "violin": GeomDef(
        "Violin", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric",
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)],
        aes=["color"]),
    "bar": GeomDef(
        "Bar ± error", "group_comparison", True, ["x", "y"],
        x_type="categorical", y_type="numeric",
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
    # descriptive geoms accept no aesthetic channels in Phase 2: a colored,
    # per-level histogram/density overlay tangles with the single-series KDE and
    # median annotations, so it is deferred to a follow-up. Keeping aes empty
    # means the frontend never offers a channel the descriptive builder ignores.
    "histogram": GeomDef(
        "Histogram", "descriptive", True, ["y"],
        x_type="none", y_type="numeric",
        params={},
        param_specs=[_num("hist_bins", "Bins", lo=0, hi=200, step=1)]),
    "density": GeomDef(
        "Density", "descriptive", True, ["y"],
        x_type="none", y_type="numeric",
        params={}, param_specs=[]),
}


def registry_payload() -> dict:
    """JSON-safe registry for the frontend rail (served on /health)."""
    return {
        "point_cap": POINT_CAP,
        "geoms": {
            name: {"label": g.label, "family": g.family,
                   "aggregates": g.aggregates, "needs": list(g.needs),
                   "x_type": g.x_type, "y_type": g.y_type,
                   "params": dict(g.params), "param_specs": list(g.param_specs),
                   "point_cap": g.point_cap, "aes": list(g.aes)}
            for name, g in GEOMS.items()
        },
    }
