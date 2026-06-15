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
    params: dict = field(default_factory=dict)        # default param values
    param_specs: list[dict] = field(default_factory=list)  # frontend editors
    point_cap: int | None = None      # blocking cap for per-row geoms


def _num(key, label, *, lo, hi, step):
    return {"key": key, "label": label, "type": "number",
            "min": lo, "max": hi, "step": step}


def _err_select(key="error_type", label="Error bars"):
    return {"key": key, "label": label, "type": "select",
            "options": ["ci95", "sem", "sd"]}


GEOMS: dict[str, GeomDef] = {
    "dot": GeomDef(
        "Dots", "group_comparison", False, ["x", "y"],
        params={"jitter": 0.18},
        param_specs=[_num("jitter", "Jitter", lo=0.0, hi=0.5, step=0.02)],
        point_cap=POINT_CAP),
    "summary": GeomDef(
        "Mean ± error", "group_comparison", True, ["x", "y"],
        params={"error_type": "ci95"},
        param_specs=[_err_select()]),
    "box": GeomDef(
        "Box", "group_comparison", True, ["x", "y"],
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)]),
    "violin": GeomDef(
        "Violin", "group_comparison", True, ["x", "y"],
        params={},
        param_specs=[_num("mark_width", "Width", lo=0.1, hi=1.0, step=0.05)]),
    "bar": GeomDef(
        "Bar ± error", "group_comparison", True, ["x", "y"],
        params={"error_type": "ci95"},
        param_specs=[_err_select()]),
    "scatter": GeomDef(
        "Scatter", "correlation", False, ["x", "y"],
        params={},
        param_specs=[],
        point_cap=POINT_CAP),
    "regression": GeomDef(
        "Regression", "correlation", True, ["x", "y"],
        params={}, param_specs=[]),
    "histogram": GeomDef(
        "Histogram", "descriptive", True, ["y"],
        params={},
        param_specs=[_num("hist_bins", "Bins", lo=0, hi=200, step=1)]),
    "density": GeomDef(
        "Density", "descriptive", True, ["y"],
        params={}, param_specs=[]),
}


def registry_payload() -> dict:
    """JSON-safe registry for the frontend rail (served on /health)."""
    return {
        "point_cap": POINT_CAP,
        "geoms": {
            name: {"label": g.label, "family": g.family,
                   "aggregates": g.aggregates, "needs": list(g.needs),
                   "params": dict(g.params), "param_specs": list(g.param_specs),
                   "point_cap": g.point_cap}
            for name, g in GEOMS.items()
        },
    }
