"""Compile an analysis spec to a matplotlib figure with gid-tagged points.

WYSIWYG rule: the figure is laid out at its physical size (mm). The SVG sent
to the screen and the exported SVG/PDF come from the same renderer at the
same size; PNG only adds rasterization DPI.
"""
from __future__ import annotations

import io
import zlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.lines as mlines
import matplotlib.pyplot as plt
import matplotlib.transforms as mtransforms
import numpy as np
import pandas as pd
from scipy import stats as sps

from . import hierarchy as hierarchy_mod
from . import scales as scales_mod
from . import stats as stats_mod

MM = 1 / 25.4
# Okabe–Ito: an 8-colour qualitative palette that stays distinguishable under
# the common forms of colour blindness. Default for every aesthetic series and
# group palette, so figures are colourblind-safe out of the box. Black sits last
# so a single-series plot leads with a coloured (not black) mark.
PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442",
           "#0072B2", "#D55E00", "#CC79A7", "#000000"]
INK = "#0f172a"

STYLE_PRESETS = {
    "demo_default": {"width_mm": 140, "height_mm": 100, "font_pt": 9},
    "nature_single_column": {"width_mm": 89, "height_mm": 70, "font_pt": 7},
    "nature_double_column": {"width_mm": 183, "height_mm": 100, "font_pt": 7},
}

# every visual knob the style panel exposes; presets fill the size keys,
# overrides may replace any of these (None = "use the plot's own default")
STYLE_DEFAULTS = {
    "marker_size": 22.0,     # scatter/dot area in pt²
    "marker_alpha": 0.55,
    "jitter": 0.18,          # half-width of dot jitter in group units
    "axis_linewidth": 0.8,   # spines + ticks
    "line_width": 1.4,       # stat lines: regression, summary CI, density
    "frame": "open",         # "open" hides top/right spines, "closed" keeps all
    "grid_x": None,          # vertical grid lines; None = plot default
    "grid_y": None,          # horizontal grid lines; None = plot default
    "palette": PALETTE,      # group colors in level order; [0] for single-series
    "title": "",             # empty = no title / auto axis label
    "x_label": "",
    "y_label": "",
    "offsets": {},           # {"lbl-x": [dx, dy], ...} from dragging, SVG px (y down)
    # axes & ticks
    "tick_direction": "out",     # out | in | inout
    "tick_length": 3.5,          # pt
    "x_tick_side": "bottom",     # bottom | top
    "y_tick_side": "left",       # left | right
    "x_tick_spacing": None,      # data units; numeric axes only; None = auto
    "y_tick_spacing": None,
    "minor_ticks": False,
    "x_tick_rotation": 0,        # degrees, for long level names
    "y_scale": "linear",         # linear | log
    "x_scale": "linear",         # numeric x only
    "y_min": None, "y_max": None, "x_min": None, "x_max": None,
    # marks
    "notch": False,              # boxplot notches (median 95% CI)
    "mark_width": None,          # box/violin/bar width; None = per-mark default
    "outlier_marker": "o",       # o | D | x | + | none (when boxes hide raw dots)
    "outlier_size": 3.0,
    "error_type": "ci95",        # ci95 | sem | sd — summary + bar error bars
    "capsize": 3.0,
    "hist_bins": None,           # histogram bin count; None = auto
    # annotations
    "show_n": True,
    "show_significance": True,
    "show_annotation": True,     # r/p text, median label
    "show_legend": None,         # None = auto (shown iff a channel needs it)
}


def _rc(style: dict) -> dict:
    font_pt = style["font_pt"]
    closed = style["frame"] == "closed"
    x_top = style["x_tick_side"] == "top"
    y_right = style["y_tick_side"] == "right"
    return {
        "svg.fonttype": "none",          # real text in SVG (editable, selectable)
        "pdf.fonttype": 42,              # TrueType in PDF (editable in Illustrator)
        "font.family": "sans-serif",
        "font.size": font_pt,
        "axes.titlesize": font_pt,
        "axes.labelsize": font_pt,
        "xtick.labelsize": font_pt - 1,
        "ytick.labelsize": font_pt - 1,
        "axes.spines.top": closed or x_top,
        "axes.spines.right": closed or y_right,
        "axes.spines.bottom": closed or not x_top,
        "axes.spines.left": closed or not y_right,
        "axes.linewidth": style["axis_linewidth"],
        "xtick.major.width": style["axis_linewidth"],
        "ytick.major.width": style["axis_linewidth"],
        "xtick.minor.width": style["axis_linewidth"] * 0.75,
        "ytick.minor.width": style["axis_linewidth"] * 0.75,
        "xtick.direction": style["tick_direction"],
        "ytick.direction": style["tick_direction"],
        "xtick.major.size": style["tick_length"],
        "ytick.major.size": style["tick_length"],
        "xtick.minor.size": style["tick_length"] * 0.55,
        "ytick.minor.size": style["tick_length"] * 0.55,
        "xtick.bottom": not x_top, "xtick.top": x_top,
        "xtick.labelbottom": not x_top, "xtick.labeltop": x_top,
        "ytick.left": not y_right, "ytick.right": y_right,
        "ytick.labelleft": not y_right, "ytick.labelright": y_right,
        "axes.edgecolor": "#475569",
        "xtick.color": "#475569",
        "ytick.color": "#475569",
        "axes.labelcolor": INK,
        "text.color": INK,
    }


def _stable_jitter(row_id: str, width: float = 0.18) -> float:
    h = zlib.crc32(str(row_id).encode())
    return ((h % 1000) / 1000 - 0.5) * 2 * width


def resolve_style(spec: dict) -> dict:
    style = spec.get("style", {})
    preset = STYLE_PRESETS.get(style.get("preset"), STYLE_PRESETS["demo_default"])
    resolved = {**STYLE_DEFAULTS, **preset}
    for k, v in (style.get("overrides") or {}).items():
        if v is None:
            continue
        if k == "font_size_pt":
            resolved["font_pt"] = v
        elif k in resolved:
            resolved[k] = v
    return resolved


def _group_color(style: dict, i: int) -> str:
    palette = style["palette"] or PALETTE
    return palette[i % len(palette)]


def _aes_arrays(rows, sc, num_color_col) -> dict:
    """Per-row aesthetic values a dot layer varies *within* a group: numeric
    color (Phase 3b), size (marker area), and shape (categorical marker). Spread
    into the group dict; aggregate geoms (bar/box/violin/summary) ignore them."""
    # size/shape/numeric-colour are per-row channels that only exist at the raw
    # level; coarser level tables aggregate those columns away, so guard on
    # presence and fall back to None (group colour, default size) for a coarse
    # mark — exactly the "a unit mark is an aggregate" rule from the spec.
    def _has(col):
        return col and col in rows.columns
    return {
        "cvals": (rows[num_color_col].to_numpy(dtype=float)
                  if _has(num_color_col) else None),
        "svals": (rows[sc.size_col].to_numpy(dtype=float)
                  if _has(sc.size_col) else None),
        "shvals": (rows[sc.shape_col].astype(str).to_numpy()
                   if _has(sc.shape_col) else None),
    }


def _drawn_value_max(ax, horizontal: bool) -> float:
    """The top of what is actually DRAWN on the value axis, read from the axes'
    data limits after all geoms are added. matplotlib's dataLim only grows to
    artists it has drawn, so a bar/summary excludes the raw outliers (their dots
    aren't drawn) while a box with fliers or a dot layer includes them — exactly
    "the range of what's on the plot." Used to anchor the significance bracket
    so it clears the drawn content without stretching the axis to undrawn
    outliers (TODO item 7)."""
    bb = ax.dataLim
    v = bb.x1 if horizontal else bb.y1
    if np.isfinite(v):
        return float(v)
    lim = ax.get_xlim() if horizontal else ax.get_ylim()
    return float(lim[1])


def _err_half(s: dict, error_type: str) -> float:
    """Half-length of an error bar for one group summary."""
    if error_type == "sem":
        return s["sd"] / np.sqrt(s["n"]) if s["n"] else 0.0
    if error_type == "sd":
        return s["sd"]
    return s["ci95_half"]


def _apply_axes(ax, style: dict, *, x_numeric: bool,
                grid_x_default: bool, grid_y_default: bool):
    """Scales, limits, tick locators, label rotation, grids — everything that
    has to run after the data is drawn. Categorical x ignores the numeric-x
    knobs (spacing, scale, limits)."""
    from matplotlib.ticker import AutoMinorLocator, MultipleLocator

    if x_numeric:
        if style["x_scale"] == "log":
            ax.set_xscale("log")
        elif style["x_tick_spacing"]:
            ax.xaxis.set_major_locator(MultipleLocator(style["x_tick_spacing"]))
        if style["x_min"] is not None or style["x_max"] is not None:
            ax.set_xlim(left=style["x_min"], right=style["x_max"])
    if style["y_scale"] == "log":
        ax.set_yscale("log")
    elif style["y_tick_spacing"]:
        ax.yaxis.set_major_locator(MultipleLocator(style["y_tick_spacing"]))
    if style["y_min"] is not None or style["y_max"] is not None:
        # skip a degenerate y_min == y_max (singular-transform warning); a zero-
        # height range can't be drawn, so leave the autoscaled limits in place
        if not (style["y_min"] is not None and style["y_min"] == style["y_max"]):
            ax.set_ylim(bottom=style["y_min"], top=style["y_max"])

    if style["minor_ticks"]:
        if x_numeric and style["x_scale"] != "log":
            ax.xaxis.set_minor_locator(AutoMinorLocator())
        if style["y_scale"] != "log":
            ax.yaxis.set_minor_locator(AutoMinorLocator())

    if style["x_tick_side"] == "top":
        ax.xaxis.set_label_position("top")
    if style["y_tick_side"] == "right":
        ax.yaxis.set_label_position("right")
    rot = style["x_tick_rotation"]
    if rot:
        plt.setp(ax.get_xticklabels(), rotation=rot,
                 ha="right" if 0 < rot < 90 else "center")

    gx = style["grid_x"] if style["grid_x"] is not None else grid_x_default
    gy = style["grid_y"] if style["grid_y"] is not None else grid_y_default
    if gx:
        ax.grid(axis="x", color="#e2e8f0", lw=0.6, zorder=0)
    if gy:
        ax.grid(axis="y", color="#e2e8f0", lw=0.6, zorder=0)
    ax.set_axisbelow(True)


def _decorate(fig, ax, style: dict, extra: dict | None = None, *, faceted: bool = False):
    """Title/label text overrides, gid tags for draggable labels, and the
    drag offsets the frontend wrote back into the style (SVG px, y down —
    matplotlib points run y up, hence the sign flip).

    Phase 4: when faceted, title/x/y are figure-level (one shared
    suptitle/supxlabel/supylabel instead of per-cell axis text) — singular
    chrome for the whole grid, per the "one legend, one colorbar, one set of
    labels" decision. Per-cell strip titles are drawn separately and are not
    draggable."""
    if faceted:
        sup_title = fig.suptitle(style["title"]) if style["title"] else None
        sup_x = fig.supxlabel(style["x_label"]) if style["x_label"] else None
        sup_y = fig.supylabel(style["y_label"]) if style["y_label"] else None
        artists = {"lbl-title": sup_title, "lbl-x": sup_x, "lbl-y": sup_y,
                   **(extra or {})}
    else:
        if style["title"]:
            ax.set_title(style["title"])
        if style["x_label"]:
            ax.set_xlabel(style["x_label"])
        if style["y_label"]:
            ax.set_ylabel(style["y_label"])
        artists = {"lbl-title": ax.title, "lbl-x": ax.xaxis.label,
                   "lbl-y": ax.yaxis.label, **(extra or {})}
    for key, art in artists.items():
        if art is None or not art.get_text():
            continue
        art.set_gid(key)
        off = (style["offsets"] or {}).get(key)
        if off and (off[0] or off[1]):
            art.set_transform(art.get_transform() + mtransforms.ScaledTranslation(
                off[0] / 72, -off[1] / 72, fig.dpi_scale_trans))


def _draw_legend(fig, ax, sc, style, x_col, *, faceted: bool = False):
    """Legend for the mapped aesthetic channels. Color is omitted when it just
    re-encodes x (the axis already names those groups, decision #3). Honors an
    explicit show_legend override; otherwise auto-shows iff there is something
    to explain. The legend is a real artist (editable SVG text) tagged gid
    'legend' and nudgeable via offsets['legend'], like the draggable labels.

    Phase 4: when faceted, the legend is drawn on the figure (one shared
    legend outside the grid) rather than inside whichever cell's `ax` is
    passed in."""
    entries = [e for e in sc.legend_entries()
               if not (e["channel"] == "color" and e["label"] == x_col)]
    pref = style.get("show_legend")
    if pref is False or not entries:
        return
    handles, labels = [], []
    for e in entries:
        for sw in e["swatches"]:
            if e["channel"] == "shape":
                h = mlines.Line2D([], [], marker=sw["marker"], linestyle="none",
                                  color=INK, markersize=6)
            elif e["channel"] == "size":
                h = mlines.Line2D([], [], marker="o", linestyle="none",
                                  color=INK, markersize=max(3.0, sw["size"] ** 0.5))
            else:  # color
                h = mlines.Line2D([], [], marker="o", linestyle="none",
                                  color=sw["color"], markersize=6)
            handles.append(h)
            labels.append(f"{sw['value']:g}" if isinstance(sw["value"], float)
                          else str(sw["value"]))
    title = entries[0]["label"] if len(entries) == 1 else None
    leg = (fig.legend(handles, labels, loc="outside right upper", frameon=False,
                      title=title, fontsize=style["font_pt"] - 1)
           if faceted else
           ax.legend(handles, labels, loc="best", frameon=False, title=title,
                     fontsize=style["font_pt"] - 1))
    leg.set_gid("legend")
    off = (style["offsets"] or {}).get("legend")
    if off and (off[0] or off[1]):
        leg.set_transform(leg.get_transform() + mtransforms.ScaledTranslation(
            off[0] / 72, -off[1] / 72, fig.dpi_scale_trans))
    return leg


def _draw_colorbar(fig, ax, mappable, style, label):
    """Phase 3b: the colorbar a numeric color channel draws in place of legend
    swatches. Honors show_legend (None = auto, False = hide); no-op when no
    numeric-color mappable was produced. Kept visually quiet (no outline) to
    match the open-frame look."""
    if mappable is None or style.get("show_legend") is False:
        return None
    cb = fig.colorbar(mappable, ax=ax, fraction=0.046, pad=0.04)
    cb.set_label(label, fontsize=style["font_pt"] - 1)
    cb.ax.tick_params(labelsize=style["font_pt"] - 1)
    cb.outline.set_visible(False)
    return cb


def _facet_levels(df: pd.DataFrame, spec: dict):
    """Phase 4: resolve (row_col, col_col, row_levels, col_levels) for the
    facet grid, restricted to levels actually present in the data. An
    unfaceted axis returns [None] so callers can loop uniformly with a single
    iteration — the unfaceted path is then just a 1×1 grid."""
    facet = spec.get("facet") or {}
    row = facet.get("row")
    col = facet.get("col")
    row_col = row["column"] if row and row.get("column") else None
    col_col = col["column"] if col and col.get("column") else None
    row_levels = (sorted(df[row_col].dropna().astype(str).unique().tolist())
                  if row_col and row_col in df else [None])
    col_levels = (sorted(df[col_col].dropna().astype(str).unique().tolist())
                  if col_col and col_col in df else [None])
    return row_col, col_col, row_levels, col_levels


def _facet_cell_df(df: pd.DataFrame, row_col, col_col, rlevel, clevel) -> pd.DataFrame:
    out = df
    if row_col is not None and rlevel is not None:
        out = out[out[row_col].astype(str) == rlevel]
    if col_col is not None and clevel is not None:
        out = out[out[col_col].astype(str) == clevel]
    return out


def _facet_title(row_col, col_col, rlevel, clevel) -> str:
    parts = []
    if row_col is not None and rlevel is not None:
        parts.append(f"{row_col} = {rlevel}")
    if col_col is not None and clevel is not None:
        parts.append(f"{col_col} = {clevel}")
    return "  |  ".join(parts)


def _build_grid(width_mm: float, height_mm: float, n_rows: int, n_cols: int,
                sharex: bool, sharey: bool):
    """plt.subplots wrapper for the facet grid; squeeze=False keeps `axes`
    a uniform 2D array even for a 1×1 (unfaceted) or 1×N grid, so callers
    never need a special case for "no facets".

    width_mm/height_mm are the *per-cell* target, so the whole figure grows with
    the grid (small-multiples convention). A fixed total figure size instead
    shrank every cell as the grid grew until constrained_layout could no longer
    fit the fixed-size chrome (ticks, per-facet titles, shared legend) and
    collapsed the axes to zero size — i.e. "facets cannot be plotted" (item 12).
    For a 1×1 grid this is width_mm × height_mm, so the unfaceted path is
    unchanged."""
    return plt.subplots(n_rows, n_cols,
                        figsize=(width_mm * n_cols * MM, height_mm * n_rows * MM),
                        layout="constrained", sharex=sharex, sharey=sharey,
                        squeeze=False)


def build_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict,
                 level_tables: dict | None = None):
    """Dispatch on the inferred stat_model family. Returns (fig, point_groups);
    point_groups maps SVG gids to row ids in draw order, so the frontend can
    wire click-to-exclude per point (empty for aggregate-only figures).

    `level_tables` (the data hierarchy's per-level tables) is consumed only by
    the group-comparison path, where each layer draws from its bound level."""
    family = spec["stat_model"]["family"]
    if family == "correlation":
        return build_scatter_figure(df, schema, spec, stats)
    if family == "descriptive":
        return build_histogram_figure(df, schema, spec, stats)
    if family == "contingency":
        return build_tile_figure(df, schema, spec, stats)
    return build_comparison_figure(df, schema, spec, stats, level_tables)


def _param(params: dict, key: str, style: dict, style_key: str):
    """A layer param wins over the global style; falling back to style keeps
    legacy specs (which carry no params) pixel-identical to today."""
    v = params.get(key)
    return v if v is not None else style[style_key]


def _is_categorical(schema, name):
    return any(c["name"] == name and c["type"] == "categorical"
               for c in schema["columns"])


def _summary_of(label, ys):
    """Per-cell summary in stats._summary's shape, for dodged sub-groups whose
    (x × color) cells aren't present in the x-only stats summaries."""
    n = len(ys)
    ci = float(sps.t.ppf(0.975, n - 1) * sps.sem(ys)) if n > 1 else 0.0
    return {"group": label, "n": n,
            "mean": float(np.mean(ys)) if n else 0.0,
            "sd": float(np.std(ys, ddof=1)) if n > 1 else 0.0,
            "ci95_half": ci}


def _resolve_cat_val(schema, enc):
    """Phase 3c: detect horizontal orientation (categorical y + numeric x).
    Returns (cat_col, val_col, h_orient) — cat_col is the categorical column
    (groups), val_col the numeric column (values). The stats result always
    groups by cat_col regardless of which encoding axis it sits on."""
    enc_x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
    enc_y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
    h_orient = _is_categorical(schema, enc_y) and enc_x is not None
    return (enc_y, enc_x, True) if h_orient else (enc_x, enc_y, False)


def _cat_levels(df, schema, cat_col):
    """Ordered category levels for the grouping axis: the schema's declared
    levels (restricted to those present in the data), else the sorted distinct
    values. Replaces stats["levels"] now that the figure is stats-independent."""
    if not cat_col or cat_col not in df.columns:
        return []
    sch = next((c for c in schema["columns"] if c["name"] == cat_col), None)
    present = set(df[cat_col].dropna().astype(str).unique())
    declared = [lv for lv in ((sch.get("levels") if sch else None) or []) if lv in present]
    return declared or sorted(present)


def _layout(df, schema, spec, *, scales=None):
    """Level-independent figure geometry shared by every layer: the grouping
    (categorical) vs. value axis, orientation, ordered x levels, the colour/dodge
    split, slot widths, and the resolved aesthetic scales. Per-layer data (group
    ys + point ids) is built separately by `_groups` from that layer's level
    table, so every layer shares one x axis regardless of the level it draws."""
    enc = spec["encodings"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    cat_col, val_col, h_orient = _resolve_cat_val(schema, enc)
    levels = _cat_levels(df, schema, cat_col)

    color = enc.get("color")
    color_col = color["column"] if color and color.get("column") else None
    dodged = (color_col is not None and color_col != cat_col
              and _is_categorical(schema, color_col))
    sc = scales if scales is not None else scales_mod.resolve_scales(
        enc, df[df[val_col].notna()] if val_col in df else df, schema, style)

    if dodged:
        clevels = list(sc.color_levels)
        slot = 0.8 / max(1, len(clevels))
        wscale = slot
    else:
        clevels, slot, wscale = [None], 0.8, 1.0

    has_dots = any(l["geom"] == "dot" for l in spec.get("layers", []))
    return {"cat_col": cat_col, "val_col": val_col, "x": cat_col, "y": val_col,
            "h_orient": h_orient, "cols": cols, "style": style, "levels": levels,
            "color_col": color_col, "dodged": dodged, "clevels": clevels,
            "slot": slot, "wscale": wscale, "scales": sc, "has_dots": has_dots,
            "lw": style["line_width"], "summary_dx": 0.0 if dodged else 0.28,
            "cbar_mappable": None, "gid_start": 0}


def _group(rows, lv, pos, color, layout):
    """One (x-level [× colour]) cell of a layer's level table → a group dict.
    `point_ids[k]` is the chained list of raw row-ids behind the k-th point
    (the row's own id at the raw level), so excluding any mark — raw point or
    coarse aggregate — drops every underlying raw row uniformly."""
    val_col, sc = layout["val_col"], layout["scales"]
    num_color_col = layout["color_col"] if sc.color_numeric else None
    ys = rows[val_col].to_numpy(dtype=float) if val_col in rows else np.array([])
    if "row_ids" in rows:
        point_ids = [list(r) for r in rows["row_ids"].tolist()]
    else:
        point_ids = [[i] for i in rows["id"].tolist()]
    return {"pos": pos, "lv": lv, "ys": ys, "color": color,
            "point_ids": point_ids,
            "keys": rows["id"].tolist() if "id" in rows else list(range(len(ys))),
            "summary": _summary_of(lv, ys),
            **_aes_arrays(rows, sc, num_color_col)}


def _groups(level_df, layout):
    """The per-(x-level × colour) groups for one layer's level table. The only
    thing that differs between layers is which level table is passed here; the
    geometry (positions, colours, dodge) comes from the shared `layout`."""
    cat_col, val_col = layout["cat_col"], layout["val_col"]
    has = val_col in level_df.columns

    def _rows_for(mask):
        rows = level_df[mask]
        return rows[rows[val_col].notna()] if has else rows

    groups = []
    if layout["dodged"]:
        color_col, clevels, slot = layout["color_col"], layout["clevels"], layout["slot"]
        for li, lv in enumerate(layout["levels"]):
            for cj, clv in enumerate(clevels):
                rows = _rows_for((level_df[cat_col].astype(str) == lv)
                                 & (level_df[color_col].astype(str) == clv))
                pos = li + (cj - (len(clevels) - 1) / 2) * slot
                groups.append(_group(rows, lv, pos, layout["scales"].color_for(clv),
                                     layout))
    else:
        for li, lv in enumerate(layout["levels"]):
            rows = _rows_for(level_df[cat_col].astype(str) == lv)
            groups.append(_group(rows, lv, li,
                                 _group_color(layout["style"], li), layout))
    return groups


def _geom_violin(ax, ctx, layer):
    params = layer.get("params") or {}
    style, lw = ctx["style"], ctx["lw"]
    h = ctx["h_orient"]
    width = (_param(params, "mark_width", style, "mark_width") or 0.7) * ctx["wscale"]
    for grp in ctx["groups"]:
        ys = grp["ys"]
        if len(ys) <= 1:
            continue
        orient = "vertical" if not h else "horizontal"
        vp = ax.violinplot([ys], positions=[grp["pos"]], widths=width,
                           orientation=orient, showextrema=False)
        for body in vp["bodies"]:
            body.set_facecolor(grp["color"]); body.set_alpha(0.22)
            body.set_edgecolor(grp["color"]); body.set_linewidth(lw * 0.6)
            body.set_zorder(1)
    return None


def _geom_box(ax, ctx, layer):
    params = layer.get("params") or {}
    style, lw = ctx["style"], ctx["lw"]
    h = ctx["h_orient"]
    width = (_param(params, "mark_width", style, "mark_width") or 0.42) * ctx["wscale"]
    show_fliers = not ctx["has_dots"] and style["outlier_marker"] != "none"
    line = dict(color="#475569", linewidth=lw * 0.65)
    for grp in ctx["groups"]:
        ys = grp["ys"]
        if not len(ys):
            continue
        orient = "vertical" if not h else "horizontal"
        ax.boxplot([ys], positions=[grp["pos"]], widths=width,
                   orientation=orient,
                   notch=style["notch"] and len(ys) > 5, showfliers=show_fliers,
                   boxprops=line, whiskerprops=line, capprops=line,
                   medianprops=dict(color=INK, linewidth=lw * 0.93),
                   flierprops=dict(marker=style["outlier_marker"],
                                   markersize=style["outlier_size"],
                                   markerfacecolor=grp["color"],
                                   markeredgecolor=grp["color"],
                                   markeredgewidth=0.8),
                   zorder=2)
    return None


def _geom_bar(ax, ctx, layer):
    params = layer.get("params") or {}
    style, lw = ctx["style"], ctx["lw"]
    h = ctx["h_orient"]
    error_type = _param(params, "error_type", style, "error_type")
    width = (style["mark_width"] or 0.6) * ctx["wscale"]
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        if h:
            ax.barh(grp["pos"], s["mean"], height=width, color=grp["color"],
                    alpha=0.55, zorder=1)
            ax.errorbar(s["mean"], grp["pos"], xerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw * 0.85, capsize=style["capsize"], zorder=3)
        else:
            ax.bar(grp["pos"], s["mean"], width=width, color=grp["color"],
                   alpha=0.55, zorder=1)
            ax.errorbar(grp["pos"], s["mean"], yerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw * 0.85, capsize=style["capsize"], zorder=3)
    return None


def _geom_dot(ax, ctx, layer):
    """Dots for one layer's level table — one mark per row of that level. At the
    raw level this is one mark per observation, honouring the per-point color
    (numeric via colormap), size, and shape channels (a mapped shape splits a
    group into one scatter call per marker, each its own point-group so the
    gid → row-ids click/exclude contract survives). At a coarser level it is one
    prominent mark per grain (e.g. one per date) — the superplot's "big marks"
    that make n visible — coloured by group, with the per-row channels bypassed
    (a coarse mark is an aggregate). Each mark carries the chained raw row-ids of
    everything it aggregates, so excluding it drops the whole unit.

    Per-layer `marker_size` and `alpha` params let a raw layer be faint/small and
    an aggregate layer bold/large within one composed figure."""
    params = layer.get("params") or {}
    style = ctx["style"]
    scales = ctx["scales"]
    h = ctx["h_orient"]
    jitter = _param(params, "jitter", style, "jitter") * ctx["wscale"]
    msize = _param(params, "marker_size", style, "marker_size")
    malpha = _param(params, "alpha", style, "marker_alpha")
    point_group, idx = [], ctx["gid_start"]
    for grp in ctx["groups"]:
        ys, point_ids, keys = grp["ys"], grp["point_ids"], grp["keys"]
        # jitter runs along the categorical axis (y in horizontal mode), keyed by
        # each mark's stable level-row id so a redraw keeps points put.
        cat_pos = grp["pos"] + np.array([_stable_jitter(k, jitter) for k in keys]) \
            if len(ys) else np.array([])
        cvals, svals, shvals = grp.get("cvals"), grp.get("svals"), grp.get("shvals")
        # one sub-series per shape level (each a distinct marker); no shape → one
        sub_series = ([(scales.marker_for(lv), np.flatnonzero(shvals == lv))
                       for lv in scales.shape_levels]
                      if shvals is not None
                      else [("o", np.arange(len(ys)))])
        for marker, sel in sub_series:
            if not len(sel):
                continue
            size = (np.array([scales.size_for(v) for v in svals[sel]])
                    if svals is not None else msize)
            common = dict(s=size, marker=marker, alpha=malpha,
                          linewidths=0.6, edgecolors="white", zorder=3)
            px, py = (ys[sel], cat_pos[sel]) if h else (cat_pos[sel], ys[sel])
            if scales.color_numeric and cvals is not None:
                # Phase 3b: colour each raw dot by its numeric value via the
                # colormap; keep a mappable for the colorbar.
                coll = ax.scatter(px, py, c=cvals[sel], cmap=scales.color_cmap,
                                  vmin=scales.color_lo, vmax=scales.color_hi,
                                  **common)
                ctx["cbar_mappable"] = coll
            else:
                coll = ax.scatter(px, py, color=grp["color"], **common)
            gid = f"pts-{idx}"
            coll.set_gid(gid)
            # row_ids[k] is the chained raw-id list behind the k-th drawn point
            point_group.append({"gid": gid,
                                "row_ids": [point_ids[k] for k in sel]})
            idx += 1
    return point_group


def _geom_summary(ax, ctx, layer):
    params = layer.get("params") or {}
    style, lw = ctx["style"], ctx["lw"]
    h = ctx["h_orient"]
    error_type = _param(params, "error_type", style, "error_type")
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        # summary_dx offsets along the categorical axis (same logic for both)
        cpos = grp["pos"] + ctx["summary_dx"]
        if h:
            ax.errorbar(s["mean"], cpos, xerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw, capsize=style["capsize"], zorder=4)
            ax.plot(s["mean"], cpos, marker="D", ms=5, color=INK, zorder=5)
        else:
            ax.errorbar(cpos, s["mean"], yerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw, capsize=style["capsize"], zorder=4)
            ax.plot(cpos, s["mean"], marker="D", ms=5, color=INK, zorder=5)
    return None


_COMPARISON_GEOMS = {"violin": _geom_violin, "box": _geom_box, "bar": _geom_bar,
                     "dot": _geom_dot, "summary": _geom_summary}


def build_comparison_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict,
                            level_tables: dict | None = None):
    """Group comparison as ordered geom layers, each drawing from the data
    *level* it is bound to (`layer.level`). The shared `_layout` fixes the x axis
    once; per layer, that layer's level table (from `level_tables`, keyed by
    level name) is filtered to the facet cell and turned into groups by
    `_groups`. A dot at the raw level is the faint replicate cloud; a dot at a
    coarse level is one bold mark per grain; a summary at a coarse level shows
    mean ± error of that level's spread — composing a superplot with no preset.

    Stats are deferred (the redesign), so no significance bracket or n label is
    drawn here; the figure no longer depends on the inferential `stats` result.

    Phase 4 facets: one cell per (row × col) level into a shared grid, with the
    colour/size/shape scales resolved ONCE so they stay consistent across cells.
    `level_tables` defaults to a single raw level (the plain reduced frame)."""
    style = resolve_style(spec)
    if not level_tables:
        level_tables = {hierarchy_mod.RAW: (df, schema)}
    cat_col, val_col, h_orient = _resolve_cat_val(schema, spec["encodings"])
    sc_global = scales_mod.resolve_scales(
        spec["encodings"], df[df[val_col].notna()] if val_col in df else df,
        schema, style)
    layout = _layout(df, schema, spec, scales=sc_global)
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}
    layers = spec.get("layers", [])

    with plt.rc_context(_rc(style)):
        fig, axes = _build_grid(style["width_mm"], style["height_mm"],
                                len(row_levels), len(col_levels),
                                sharex=facet_cfg.get("share_x", True),
                                sharey=facet_cfg.get("share_y", True))
        point_groups, gid_next = [], 0
        cbar_mappable, last_ax = None, None
        levels, h = layout["levels"], layout["h_orient"]
        for ri, rlevel in enumerate(row_levels):
            for ci, clevel in enumerate(col_levels):
                ax = axes[ri][ci]
                ctx = {**layout, "cbar_mappable": None}
                for layer in layers:
                    render = _COMPARISON_GEOMS.get(layer["geom"])
                    if render is None:
                        continue
                    ldf, _ = hierarchy_mod.resolve_level(level_tables, layer.get("level"))
                    cell_df = _facet_cell_df(ldf, row_col, col_col, rlevel, clevel)
                    ctx["groups"] = _groups(cell_df, layout)
                    # point-emitting geoms number their series from gid_start;
                    # advance per layer so stacked dot layers (raw + aggregate)
                    # never reuse pts-N — gids stay unique across layers AND cells.
                    ctx["gid_start"] = gid_next
                    pg = render(ax, ctx, layer)
                    if pg:
                        point_groups.extend(pg)
                        gid_next += len(pg)

                cat_labels = layout["cols"].get(cat_col, {}).get("labels", {}) or {}
                lv_labels = [cat_labels.get(lv, lv) for lv in levels]
                if h:
                    ax.set_yticks(range(len(levels)))
                    ax.set_yticklabels(lv_labels)
                    ax.set_ylim(-0.55, len(levels) - 0.45)
                    if not faceted:
                        ax.set_xlabel(layout["cols"].get(val_col, {}).get("label", val_col))
                else:
                    ax.set_xticks(range(len(levels)))
                    ax.set_xticklabels(lv_labels)
                    ax.set_xlim(-0.55, len(levels) - 0.45)
                    if not faceted:
                        ax.set_ylabel(layout["cols"].get(val_col, {}).get("label", val_col))

                # for horizontal the value axis is X (numeric); grids follow accordingly
                _apply_axes(ax, style, x_numeric=h,
                            grid_x_default=h, grid_y_default=not h)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                cbar_mappable = ctx.get("cbar_mappable") or cbar_mappable
                last_ax = ax

        cbar = sc_global.colorbar_spec()
        if cbar:
            cbar_ax = axes.ravel().tolist() if faceted else last_ax
            _draw_colorbar(fig, cbar_ax, cbar_mappable, style, cbar["label"])
        if faceted:
            val_label = layout["cols"].get(val_col, {}).get("label", val_col)
            if h:
                style["x_label"] = style["x_label"] or val_label
            else:
                style["y_label"] = style["y_label"] or val_label
        _draw_legend(fig, last_ax, sc_global, style, cat_col, faceted=faceted)
        _decorate(fig, last_ax, style, faceted=faceted)
    return fig, point_groups


def _axis_label(cols: dict, name: str) -> str:
    return cols.get(name, {}).get("label", name)


def _draw_points(ax, rows, x, y, sc, style, *, gid_start: int = 0):
    """Per-point scatter honoring the color/size/shape scales. Splits rows into
    one sub-series per (color level × shape level) so each carries its own color
    and marker, and emits one point_groups entry per sub-series so the
    click-to-exclude contract (gid → row ids) survives. With no color/shape
    mapped this is a single 'pts-0' series identical to the pre-aesthetics path;
    size, when mapped, varies marker area per point within a series.

    Returns (point_groups, colorbar_mappable, next_gid_start). A *numeric* color
    (Phase 3b) is not split into levels: each point is coloured by its value
    through the colormap (c=values + cmap), and the returned mappable feeds the
    colorbar. Phase 4: gid_start offsets the per-series counter so facet cells
    drawn into the same figure never reuse a gid."""
    numeric_color = sc.color_col is not None and sc.color_numeric
    color_levels = sc.color_levels if (sc.color_col and not numeric_color) else [None]
    shape_levels = sc.shape_levels if sc.shape_col else [None]
    split = (sc.color_col is not None and not numeric_color) or sc.shape_col is not None
    point_groups, idx, mappable = [], gid_start, None
    for cl in color_levels:
        for sl in shape_levels:
            sub = rows
            if sc.color_col is not None and not numeric_color:
                sub = sub[sub[sc.color_col].astype(str) == cl]
            if sc.shape_col is not None:
                sub = sub[sub[sc.shape_col].astype(str) == sl]
            if not len(sub):
                continue
            marker = sc.marker_for(sl) if sc.shape_col else "o"
            size = ([sc.size_for(v) for v in sub[sc.size_col]] if sc.size_col
                    else style["marker_size"])
            common = dict(s=size, marker=marker, alpha=style["marker_alpha"],
                          linewidths=0.6, edgecolors="white", zorder=3)
            if numeric_color:
                coll = ax.scatter(sub[x].to_numpy(dtype=float),
                                  sub[y].to_numpy(dtype=float),
                                  c=sub[sc.color_col].to_numpy(dtype=float),
                                  cmap=sc.color_cmap, vmin=sc.color_lo,
                                  vmax=sc.color_hi, **common)
                mappable = coll
            else:
                color = sc.color_for(cl) if sc.color_col else _group_color(style, 0)
                coll = ax.scatter(sub[x].to_numpy(dtype=float),
                                  sub[y].to_numpy(dtype=float),
                                  color=color, **common)
            gid = f"pts-{idx}" if split else f"pts-{gid_start}"
            coll.set_gid(gid)
            point_groups.append({"gid": gid, "row_ids": sub["id"].tolist()})
            idx += 1
    return point_groups, mappable, idx


def build_scatter_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Scatter of two numeric columns; the `regression` layer adds the OLS
    line and 95% CI band computed by the stats module.

    Phase 4: when faceted, draws one cell per (row level × col level); the
    regression line/CI band and r/p annotation naturally disappear in the
    faceted (describe-only) path since describe_pairs() omits both
    "regression" and "result.r" — no extra branching needed. Color/size/
    shape scales are resolved once globally; singular legend/colorbar are
    drawn once after the loop."""
    x = spec["encodings"]["x"]["column"]
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    alpha = stats.get("alpha", 0.05)
    marks = {layer["geom"] for layer in spec.get("layers", [])} or {"scatter",
                                                                    "regression"}
    rows = df[df[x].notna() & df[y].notna()]
    sc_global = scales_mod.resolve_scales(spec["encodings"], rows, schema, style)
    color = _group_color(style, 0)
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}

    with plt.rc_context(_rc(style)):
        fig, axes = _build_grid(style["width_mm"], style["height_mm"],
                                len(row_levels), len(col_levels),
                                sharex=facet_cfg.get("share_x", True),
                                sharey=facet_cfg.get("share_y", True))
        point_groups, gid_next, cbar_mappable, last_ax = [], 0, None, None
        extra = {}
        for ri, rlevel in enumerate(row_levels):
            for ci, clevel in enumerate(col_levels):
                ax = axes[ri][ci]
                cell_rows = _facet_cell_df(rows, row_col, col_col, rlevel, clevel)
                cell_stats = (stats_mod.describe_pairs(cell_rows, x, y, alpha=alpha)
                              if faceted else stats)

                reg = cell_stats.get("regression")
                if "regression" in marks and reg:
                    grid = np.asarray(reg["grid"])
                    ax.fill_between(grid, reg["lo"], reg["hi"], color=color,
                                    alpha=0.15, linewidth=0, zorder=1)
                    ax.plot(grid, reg["intercept"] + reg["slope"] * grid,
                            color=color, linewidth=style["line_width"], zorder=2)

                pg, mappable, gid_next = _draw_points(
                    ax, cell_rows, x, y, sc_global, style, gid_start=gid_next)
                point_groups.extend(pg)
                cbar_mappable = mappable or cbar_mappable

                if (style["show_annotation"]
                        and cell_stats["result"].get("r") is not None):
                    r = cell_stats["result"]
                    symbol = "r" if r["test"] == "pearson" else "ρ"
                    p_txt = "p < 0.001" if r["p"] < 0.001 else f"p = {r['p']:.3f}"
                    txt = ax.text(
                        0.02, 0.98, f"{symbol} = {r['r']:.2f}, {p_txt}",
                        transform=ax.transAxes, ha="left", va="top",
                        fontsize=style["font_pt"] - 1, color=INK)
                    if not faceted:
                        extra["lbl-annot"] = txt

                if not faceted:
                    ax.set_xlabel(_axis_label(cols, x))
                    ax.set_ylabel(_axis_label(cols, y))
                _apply_axes(ax, style, x_numeric=True,
                            grid_x_default=True, grid_y_default=True)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                last_ax = ax

        cbar = sc_global.colorbar_spec()
        if cbar:
            cbar_ax = axes.ravel().tolist() if faceted else last_ax
            _draw_colorbar(fig, cbar_ax, cbar_mappable, style, cbar["label"])
        if faceted:
            style["x_label"] = style["x_label"] or _axis_label(cols, x)
            style["y_label"] = style["y_label"] or _axis_label(cols, y)
        _draw_legend(fig, last_ax, sc_global, style, x, faceted=faceted)
        _decorate(fig, last_ax, style, extra=extra, faceted=faceted)
    return fig, point_groups


def build_histogram_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Histogram of one numeric column (mapped on y); the `density` layer
    overlays a KDE curve scaled to the count axis. Bars aggregate rows, so
    there are no per-point click targets.

    Phase 4: when faceted, draws one cell per (row level × col level), each
    with its own bars/KDE/median recomputed from that cell's own values."""
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    alpha = stats.get("alpha", 0.05)
    layers = spec.get("layers", [])
    marks = {layer["geom"] for layer in layers} or {"histogram"}
    hist_params = next((l.get("params", {}) for l in layers
                        if l["geom"] == "histogram"), {})
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}

    with plt.rc_context(_rc(style)):
        fig, axes = _build_grid(style["width_mm"], style["height_mm"],
                                len(row_levels), len(col_levels),
                                sharex=facet_cfg.get("share_x", True),
                                sharey=facet_cfg.get("share_y", True))
        extra, last_ax = {}, None
        for ri, rlevel in enumerate(row_levels):
            for ci, clevel in enumerate(col_levels):
                ax = axes[ri][ci]
                cell_df = _facet_cell_df(df, row_col, col_col, rlevel, clevel)
                vals = cell_df[y].dropna().to_numpy(dtype=float)
                bins_val = _param(hist_params, "hist_bins", style, "hist_bins")
                bins = int(bins_val) if bins_val else "auto"
                counts, edges, _ = ax.hist(
                    vals, bins=bins, color=_group_color(style, 0),
                    alpha=0.65, edgecolor="white", linewidth=0.5, zorder=2)

                if "density" in marks and len(vals) > 2 and np.ptp(vals) > 0:
                    from scipy.stats import gaussian_kde
                    grid = np.linspace(vals.min(), vals.max(), 200)
                    kde = gaussian_kde(vals)(grid)
                    binwidth = edges[1] - edges[0]
                    ax.plot(grid, kde * len(vals) * binwidth, color=INK,
                            linewidth=style["line_width"] * 0.93, zorder=3)

                cell_result = (stats_mod.descriptive(cell_df, y, alpha=alpha)
                              if faceted else stats)
                med = cell_result.get("result", {}).get("median")
                if style["show_annotation"] and med is not None:
                    ax.axvline(med, color="#475569",
                              linewidth=style["line_width"] * 0.7,
                              linestyle=(0, (4, 2)), zorder=4)
                    txt = ax.text(
                        med, ax.get_ylim()[1], f" median = {med:.2f}", ha="left",
                        va="top", fontsize=style["font_pt"] - 1, color="#475569")
                    if not faceted:
                        extra["lbl-annot"] = txt

                if not faceted:
                    ax.set_xlabel(_axis_label(cols, y))
                    ax.set_ylabel("Count")
                _apply_axes(ax, style, x_numeric=True,
                            grid_x_default=False, grid_y_default=True)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                last_ax = ax

        if faceted:
            style["x_label"] = style["x_label"] or _axis_label(cols, y)
            style["y_label"] = style["y_label"] or "Count"
        _decorate(fig, last_ax, style, extra=extra, faceted=faceted)
    return fig, []


def build_tile_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Phase 3d: tile/heatmap for categorical x × categorical y. Fill = count of
    rows in each (x_level, y_level) cell. No per-row click targets (aggregate).

    Phase 4: when faceted, draws one cell per (row level × col level), each
    with its own count matrix recomputed from that cell's own rows but
    sharing the same x_levels/y_levels (and hence matrix shape) as the
    pooled stats, so cells align. A single shared colorbar follows the max
    count across all cells, recomputed after the loop so its scale isn't
    biased toward whichever cell happened to render first."""
    enc = spec["encodings"]
    x = enc["x"]["column"]
    y = enc["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    alpha = stats.get("alpha", 0.05)

    x_levels = stats["x_levels"]
    y_levels = stats["y_levels"]
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}

    with plt.rc_context(_rc(style)):
        fig, axes = _build_grid(style["width_mm"], style["height_mm"],
                                len(row_levels), len(col_levels),
                                sharex=facet_cfg.get("share_x", True),
                                sharey=facet_cfg.get("share_y", True))
        last_ax, last_im = None, None
        vmax = 1.0
        cell_counts = {}
        for rlevel in row_levels:
            for clevel in col_levels:
                cell_df = _facet_cell_df(df, row_col, col_col, rlevel, clevel)
                cell_stats = (stats_mod.contingency_counts(
                                  cell_df, x, y, x_levels, y_levels, alpha=alpha)
                              if faceted else stats)
                counts = np.array(cell_stats["counts"], dtype=float)
                cell_counts[(rlevel, clevel)] = counts
                vmax = max(vmax, float(counts.max()) if counts.size else 0.0)

        for ri, rlevel in enumerate(row_levels):
            for ci, clevel in enumerate(col_levels):
                ax = axes[ri][ci]
                counts = cell_counts[(rlevel, clevel)]

                # imshow: rows = y_levels (top → bottom), cols = x_levels (left → right).
                # Unfaceted keeps the original auto vmin/vmax (byte-identical to
                # pre-Phase-4); faceted shares one vmin/vmax across cells so fill
                # color is comparable panel-to-panel.
                im = (ax.imshow(counts, cmap="Blues", aspect="auto",
                                origin="upper", vmin=0, vmax=vmax)
                      if faceted else
                      ax.imshow(counts, cmap="Blues", aspect="auto", origin="upper"))

                ax.set_xticks(range(len(x_levels)))
                x_lbl = cols.get(x, {}).get("labels", {}) or {}
                ax.set_xticklabels([x_lbl.get(lv, lv) for lv in x_levels])

                ax.set_yticks(range(len(y_levels)))
                y_lbl = cols.get(y, {}).get("labels", {}) or {}
                ax.set_yticklabels([y_lbl.get(lv, lv) for lv in y_levels])

                if style["show_annotation"]:
                    for yi in range(len(y_levels)):
                        for xi in range(len(x_levels)):
                            c = int(counts[yi, xi])
                            text_col = ("white" if (vmax > 0
                                       and counts[yi, xi] / vmax > 0.6) else INK)
                            ax.text(xi, yi, str(c), ha="center", va="center",
                                    fontsize=style["font_pt"] - 1, color=text_col)

                if not faceted:
                    ax.set_xlabel(_axis_label(cols, x))
                    ax.set_ylabel(_axis_label(cols, y))

                # both axes are categorical: no scale/limit style knobs apply; no grid
                _apply_axes(ax, style, x_numeric=False,
                            grid_x_default=False, grid_y_default=False)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                last_ax, last_im = ax, im

        if style.get("show_legend") is not False:
            cbar_ax = axes.ravel().tolist() if faceted else last_ax
            cb = fig.colorbar(last_im, ax=cbar_ax, fraction=0.046, pad=0.04)
            cb.set_label("Count", fontsize=style["font_pt"] - 1)
            cb.ax.tick_params(labelsize=style["font_pt"] - 1)
            cb.outline.set_visible(False)

        if faceted:
            style["x_label"] = style["x_label"] or _axis_label(cols, x)
            style["y_label"] = style["y_label"] or _axis_label(cols, y)
        _decorate(fig, last_ax, style, faceted=faceted)
    return fig, []   # aggregate: no per-point click targets


def figure_to_svg(fig) -> str:
    buf = io.StringIO()
    fig.savefig(buf, format="svg")
    return buf.getvalue()


def figure_to_bytes(fig, fmt: str, dpi: int = 300) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format=fmt, dpi=dpi)
    return buf.getvalue()


def close(fig):
    plt.close(fig)
