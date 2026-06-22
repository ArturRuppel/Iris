"""Style registry — the single source of truth for every visual knob.

Each entry declares its key, human label, group (for the frontend section it
renders in), widget metadata (type + bounds/options), default value, scope
(figure-level or geom-scoped), gating (which geoms or families it applies to,
cross-knob visibility predicates), and whether it is *transferable* (carried by
an exported style sheet — item F).

The registry replaces the four hand-synced lists that drifted apart:
STYLE_DEFAULTS, StyleOverrides (TS), StylePane's fieldsets, and geoms.py
param_specs. ``resolve_geom_style`` merges user overrides onto registry
defaults, replacing the old ``_param()`` fallback.

Frontend: ``StylePane`` renders generically from ``style_registry_payload()``
(served on ``/health``), exactly as ``LayerCards`` renders ``param_specs``.
"""
from __future__ import annotations

from .scales import PALETTE


# ---------------------------------------------------------------------------
# Registry entry helpers
# ---------------------------------------------------------------------------

def _num(key, label, group, default, *, lo=None, hi=None, step=None,
         scope="figure", geoms=None, visible_when=None, transferable=True):
    e = {"key": key, "label": label, "group": group,
         "widget": {"type": "number"},
         "default": default, "scope": scope, "transferable": transferable}
    if lo is not None:
        e["widget"]["min"] = lo
    if hi is not None:
        e["widget"]["max"] = hi
    if step is not None:
        e["widget"]["step"] = step
    if geoms:
        e["applies_to_geoms"] = geoms
    if visible_when:
        e["visible_when"] = visible_when
    return e


def _sel(key, label, group, options, default, *, scope="figure", geoms=None,
         visible_when=None, transferable=True):
    e = {"key": key, "label": label, "group": group,
         "widget": {"type": "select", "options": list(options)},
         "default": default, "scope": scope, "transferable": transferable}
    if geoms:
        e["applies_to_geoms"] = geoms
    if visible_when:
        e["visible_when"] = visible_when
    return e


def _bool(key, label, group, default, *, scope="figure", geoms=None,
          visible_when=None, transferable=True):
    e = {"key": key, "label": label, "group": group,
         "widget": {"type": "bool"},
         "default": default, "scope": scope, "transferable": transferable}
    if geoms:
        e["applies_to_geoms"] = geoms
    if visible_when:
        e["visible_when"] = visible_when
    return e


def _text(key, label, group, default, *, scope="figure", transferable=False):
    return {"key": key, "label": label, "group": group,
            "widget": {"type": "text"},
            "default": default, "scope": scope, "transferable": transferable}


def _swatch(key, label, group, default, *, scope="figure", transferable=True):
    return {"key": key, "label": label, "group": group,
            "widget": {"type": "swatch"},
            "default": default, "scope": scope, "transferable": transferable}


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

STYLE_REGISTRY: list[dict] = [
    # ---- figure (always shown, transferable) ----
    _num("width_mm", "Width", "figure", 140.0, lo=40, hi=300, step=5),
    _num("height_mm", "Height", "figure", 100.0, lo=30, hi=250, step=5),
    _num("font_pt", "Font size", "figure", 9, lo=5, hi=16, step=0.5),
    _num("axis_linewidth", "Axis width", "figure", 0.8, lo=0.3, hi=2.5, step=0.1),
    _num("line_width", "Stat lines", "figure", 1.4, lo=0.5, hi=3.0, step=0.1),
    _sel("frame", "Frame", "figure", ["open", "closed"], "open"),
    _bool("grid_x", "Vertical grid", "figure", None),
    _bool("grid_y", "Horizontal grid", "figure", None),
    _swatch("palette", "Colors", "figure", list(PALETTE)),

    # ---- axes & ticks (always shown) ----
    _sel("tick_direction", "Tick direction", "axes", ["out", "in", "inout"], "out"),
    _num("tick_length", "Tick length", "axes", 3.5, lo=0, hi=8, step=0.5),
    _sel("x_tick_side", "X ticks on", "axes", ["bottom", "top"], "bottom"),
    _sel("y_tick_side", "Y ticks on", "axes", ["left", "right"], "left"),
    _num("x_tick_spacing", "X tick every", "axes", None, lo=0, step=1, transferable=False),
    _num("y_tick_spacing", "Y tick every", "axes", None, lo=0, step=1, transferable=False),
    _bool("minor_ticks", "Minor ticks", "axes", False),
    _num("x_tick_rotation", "X tick rotation", "axes", 0, lo=0, hi=90, step=15),
    _sel("y_scale", "Y scale", "axes", ["linear", "log"], "linear"),
    _sel("x_scale", "X scale", "axes", ["linear", "log"], "linear"),
    _num("y_min", "Y min", "axes", None, transferable=False),
    _num("y_max", "Y max", "axes", None, transferable=False),
    _num("x_min", "X min", "axes", None, transferable=False),
    _num("x_max", "X max", "axes", None, transferable=False),

    # ---- text (always shown, content = not transferred) ----
    _text("title", "Title", "text", ""),
    _text("x_label", "X label", "text", ""),
    _text("y_label", "Y label", "text", ""),

    # ---- annotations (gated by family, transferable) ----
    _bool("show_n", "n per group", "annotations", True),
    _bool("show_all_levels", "Count every nesting level", "annotations", False,
          visible_when={"key": "show_n", "equals": True}),
    _bool("show_significance", "Significance bracket", "annotations", True),
    _bool("show_annotation", "Annotation", "annotations", True),
    _bool("show_legend", "Show legend", "annotations", None),

    # ---- geom-scoped: dot ----
    _sel("layout", "Layout", "dot", ["swarm", "jitter"], "swarm",
         scope="geom", geoms=["dot"]),
    _num("jitter", "Jitter", "dot", 0.18, lo=0.0, hi=0.5, step=0.02,
         scope="geom", geoms=["dot"],
         visible_when={"key": "layout", "equals": "jitter"}),
    _num("marker_size", "Point size", "dot", 22.0, lo=4, hi=140, step=2,
         scope="geom", geoms=["dot"]),
    _num("alpha", "Opacity", "dot", 0.55, lo=0.05, hi=1.0, step=0.05,
         scope="geom", geoms=["dot"]),

    # ---- geom-scoped: scatter ----
    _num("marker_size", "Point size", "scatter", 22.0, lo=4, hi=140, step=2,
         scope="geom", geoms=["scatter"]),
    _num("alpha", "Opacity", "scatter", 0.55, lo=0.05, hi=1.0, step=0.05,
         scope="geom", geoms=["scatter"]),

    # ---- geom-scoped: box ----
    _num("mark_width", "Width", "box", 0.42, lo=0.1, hi=1.0, step=0.05,
         scope="geom", geoms=["box"]),
    _bool("notch", "Notch (median CI)", "box", False,
          scope="geom", geoms=["box"]),
    _sel("outlier_marker", "Outlier marker", "box",
         ["o", "D", "x", "+", "none"], "o",
         scope="geom", geoms=["box"]),
    _num("outlier_size", "Outlier size", "box", 3.0, lo=1, hi=8, step=0.5,
         scope="geom", geoms=["box"],
         visible_when={"key": "outlier_marker", "not_equals": "none"}),
    _bool("fill", "Box fill", "box", False,
          scope="geom", geoms=["box"]),
    _num("fill_alpha", "Fill opacity", "box", 0.25, lo=0.05, hi=1.0, step=0.05,
         scope="geom", geoms=["box"],
         visible_when={"key": "fill", "equals": True}),

    # ---- geom-scoped: violin ----
    _num("mark_width", "Width", "violin", 0.7, lo=0.1, hi=1.0, step=0.05,
         scope="geom", geoms=["violin"]),
    _num("fill_alpha", "Fill opacity", "violin", 0.22, lo=0.05, hi=1.0, step=0.05,
         scope="geom", geoms=["violin"]),

    # ---- geom-scoped: bar ----
    _num("mark_width", "Width", "bar", 0.6, lo=0.1, hi=1.0, step=0.05,
         scope="geom", geoms=["bar"]),
    _sel("error_type", "Error bars", "bar", ["ci95", "sem", "sd"], "ci95",
         scope="geom", geoms=["bar"]),
    _num("capsize", "Cap size", "bar", 3.0, lo=0, hi=8, step=0.5,
         scope="geom", geoms=["bar"]),

    # ---- geom-scoped: summary ----
    _sel("error_type", "Error bars", "summary", ["ci95", "sem", "sd"], "ci95",
         scope="geom", geoms=["summary"]),
    _num("capsize", "Cap size", "summary", 3.0, lo=0, hi=8, step=0.5,
         scope="geom", geoms=["summary"]),

    # ---- geom-scoped: line (trajectories) ----
    _num("alpha", "Opacity", "line", 0.35, lo=0.05, hi=1.0, step=0.05,
         scope="geom", geoms=["line"]),
    _num("linewidth", "Line width", "line", 0.8, lo=0.3, hi=3.0, step=0.1,
         scope="geom", geoms=["line"]),

    # ---- geom-scoped: trend (mean ± band) ----
    _sel("error_type", "Error bars", "trend", ["ci95", "sem", "sd"], "ci95",
         scope="geom", geoms=["trend"]),
    _bool("show_band", "Spread band", "trend", True,
          scope="geom", geoms=["trend"]),

    # ---- geom-scoped: regression ----
    _bool("show_band", "CI band", "regression", True,
          scope="geom", geoms=["regression"]),

    # ---- geom-scoped: distribution ----
    _sel("dist_render", "Render", "distribution",
         ["bars", "step", "line", "points", "smooth", "potential"], "bars",
         scope="geom", geoms=["distribution"]),
    _sel("bin_method", "Bin method", "distribution",
         ["auto", "fd", "scott", "sturges", "sqrt", "fixed", "sinh"], "auto",
         scope="geom", geoms=["distribution"]),
    _num("hist_bins", "Bin count", "distribution", None, lo=2, hi=200, step=1,
         scope="geom", geoms=["distribution"]),
    _num("bin_sharpness", "Sinh sharpness", "distribution", 3.0,
         lo=0.0, hi=8.0, step=0.5,
         scope="geom", geoms=["distribution"]),
    _bool("overlay_smooth", "Overlay smooth (KDE)", "distribution", False,
          scope="geom", geoms=["distribution"]),

    # ---- geom-scoped: tile ----
    _sel("colormap", "Colormap", "tile",
         ["Blues", "Greens", "Reds", "Purples", "Oranges", "Greys",
          "YlOrRd", "YlGnBu", "BuPu", "RdYlBu", "viridis", "plasma"],
         "Blues", scope="geom", geoms=["tile"]),
    _bool("show_counts", "Show cell counts", "tile", True,
          scope="geom", geoms=["tile"]),
]

# offsets and axes_rect are drag-only (no widget); tracked here for
# resolve_style but not in the registry payload (no user-facing control).
_DRAG_ONLY = {
    "offsets": {},
    "axes_rect": None,
}


# ---------------------------------------------------------------------------
# Derived lookups (built once at import time)
# ---------------------------------------------------------------------------

def _build_defaults():
    """Build STYLE_DEFAULTS from the registry. Figure-scope entries produce flat
    keys; geom-scope entries are ignored here (they live under geoms.<geom>)."""
    d = {}
    for e in STYLE_REGISTRY:
        if e["scope"] == "figure":
            d[e["key"]] = e["default"]
    d.update(_DRAG_ONLY)
    return d


def _build_geom_defaults():
    """Per-geom default dicts, keyed by geom name."""
    gd: dict[str, dict] = {}
    for e in STYLE_REGISTRY:
        if e["scope"] != "geom":
            continue
        for g in e.get("applies_to_geoms", []):
            gd.setdefault(g, {})[e["key"]] = e["default"]
    return gd


STYLE_DEFAULTS: dict = _build_defaults()
GEOM_STYLE_DEFAULTS: dict[str, dict] = _build_geom_defaults()


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def resolve_style(spec: dict) -> dict:
    """Merge user overrides onto figure-level defaults. The ``geoms`` sub-object
    is passed through for ``resolve_geom_style`` to handle per-geom."""
    style_block = spec.get("style", {})
    overrides = style_block.get("overrides") or {}
    resolved = {**STYLE_DEFAULTS}
    for k, v in overrides.items():
        if v is None or k == "geoms":
            continue
        # alias: frontend sends font_size_pt, engine uses font_pt
        if k == "font_size_pt":
            resolved["font_pt"] = v
        elif k in resolved:
            resolved[k] = v
    # stash the raw geoms + per-layer overrides for resolve_geom_style callers
    resolved["_geom_overrides"] = overrides.get("geoms") or {}
    resolved["_layer_overrides"] = overrides.get("layers") or {}
    return resolved


def resolve_geom_style(style: dict, geom: str, layer_id: str | None = None) -> dict:
    """Merge user overrides onto registry defaults for *geom*. ``style`` is the
    resolved figure-level dict (from ``resolve_style``), which carries the
    ``_geom_overrides`` stash. Returns a flat dict of that geom's knob values.

    Item K: a geom may appear more than once in the layer stack (e.g. faint raw
    dots + bold aggregate dots), so style resolves in three tiers, most specific
    winning: registry default → ``geoms.<geom>`` (shared by every instance of the
    geom) → ``layers.<layer_id>`` (this one instance). Passing ``layer_id`` opts
    into the per-instance tier; without it the behaviour is the old two-tier merge."""
    defaults = GEOM_STYLE_DEFAULTS.get(geom, {})
    merged = {**defaults}
    overrides = style.get("_geom_overrides", {}).get(geom) or {}
    for k, v in overrides.items():
        if v is not None:
            merged[k] = v
    if layer_id is not None:
        per_layer = style.get("_layer_overrides", {}).get(layer_id) or {}
        for k, v in per_layer.items():
            if v is not None:
                merged[k] = v
    return merged


# ---------------------------------------------------------------------------
# Payload for /health
# ---------------------------------------------------------------------------

def style_registry_payload() -> list[dict]:
    """JSON-safe registry for the frontend StylePane (served on /health)."""
    return STYLE_REGISTRY
