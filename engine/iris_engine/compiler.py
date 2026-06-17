"""Compile an analysis spec to a matplotlib figure with gid-tagged points.

WYSIWYG rule: the figure is laid out at its physical size (mm). The SVG sent
to the screen and the exported SVG/PDF come from the same renderer at the
same size; PNG only adds rasterization DPI.
"""
from __future__ import annotations

import io
import warnings
import zlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.lines as mlines
import matplotlib.pyplot as plt
import matplotlib.transforms as mtransforms
import numpy as np
import pandas as pd

from . import geoms as geoms_mod
from . import hierarchy as hierarchy_mod
from . import scales as scales_mod
from . import stats as stats_mod
from .scales import PALETTE  # the single colour source of truth (see scales.py)

MM = 1 / 25.4
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
    "layout": "swarm",       # dot layout: "swarm" (no-overlap pack) or "jitter"
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


def _aes_arrays(rows, sc, num_color_col, cat_color_col=None) -> dict:
    """Per-row aesthetic values a dot layer varies *within* a group: numeric
    color (Phase 3b), discrete per-point color (an identifier/replicate id),
    size (marker area), and shape (categorical marker). Spread into the group
    dict; aggregate geoms (bar/box/violin/summary) ignore them."""
    # these are per-row channels that only exist where the column survives; a
    # coarser level table aggregates finer columns away, so guard on presence and
    # fall back to None (group colour, default size) for a coarse mark — exactly
    # the "a unit mark is an aggregate" rule from the spec. A color column coarser
    # than the layer's grain (e.g. date colouring per-date dots) is single-valued
    # per row and survives, so the per-point colour applies; finer columns drop.
    def _has(col):
        return col and col in rows.columns
    return {
        "cvals": (rows[num_color_col].to_numpy(dtype=float)
                  if _has(num_color_col) else None),
        # per-row discrete colour: each dot drawn in its level's palette swatch
        # with no dodge — the superplot idiom of colouring marks by replicate.
        "ccols": ([sc.color_for(v) for v in rows[cat_color_col].astype(str)]
                  if _has(cat_color_col) else None),
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


def _draw_significance(ax, res: dict, levels: list, horizontal: bool,
                       style: dict) -> None:
    """Stack one significance bracket per reported comparison above the drawn
    data. Two-group results draw a single bracket; multi-group results draw one
    per ``result['pairwise']`` entry. Brackets are ordered by span (short ones
    sit lowest, so wider spans arch over them), offset upward by a fixed step
    from the outlier-safe anchor (`_drawn_value_max`), and the value axis is
    grown to fit the whole stack — unless the user pinned the value-axis max."""
    r = (res or {}).get("result", {}) or {}
    if r.get("test") in (None, "none"):
        return
    pairwise = r.get("pairwise")
    if pairwise:
        items = [(pw["a"], pw["b"], pw["stars"]) for pw in pairwise]
    elif r.get("p") is not None and len(levels) == 2:
        items = [(levels[0], levels[1], stats_mod._p_stars(r["p"]))]
    else:
        return
    idx = {str(lv): i for i, lv in enumerate(levels)}
    spans = [(idx[str(a)], idx[str(b)], lbl) for a, b, lbl in items
             if str(a) in idx and str(b) in idx]
    if not spans:
        return
    # short spans lowest, then left-to-right, so nested brackets don't cross
    spans.sort(key=lambda t: (abs(t[1] - t[0]), min(t[0], t[1])))

    base = _drawn_value_max(ax, horizontal)
    lo, hi = ax.get_xlim() if horizontal else ax.get_ylim()
    extent = (hi - lo) or 1.0
    step = extent * 0.08          # vertical gap between stacked brackets
    tip = step * 0.3              # length of the little downward end ticks
    fs = style["font_pt"] - 1
    top = base
    for n, (i, j, lbl) in enumerate(spans):
        v = base + step * (n + 1)
        a_pos, b_pos = sorted((i, j))
        if horizontal:                       # value axis is X; brackets reach right
            ax.plot([v - tip, v, v, v - tip], [a_pos, a_pos, b_pos, b_pos],
                    lw=1.0, color=INK, clip_on=False)
            ax.text(v, (a_pos + b_pos) / 2, lbl, ha="left", va="center",
                    rotation=-90, fontsize=fs)
        else:                                # value axis is Y; brackets reach up
            ax.plot([a_pos, a_pos, b_pos, b_pos], [v - tip, v, v, v - tip],
                    lw=1.0, color=INK, clip_on=False)
            ax.text((a_pos + b_pos) / 2, v, lbl, ha="center", va="bottom",
                    fontsize=fs)
        top = v
    headroom = top + step          # clear the top label
    if horizontal:
        if style["x_max"] is None:
            ax.set_xlim(right=max(ax.get_xlim()[1], headroom))
    elif style["y_max"] is None:
        ax.set_ylim(top=max(ax.get_ylim()[1], headroom))


def _draw_n_labels(ax, counts: dict, levels: list, horizontal: bool,
                   style: dict) -> None:
    """One faint ``n = N`` label per x-level, anchored just outside the value
    axis (below a vertical plot, left of a horizontal one). ``counts`` maps a
    level name to its raw observation count; toggled by the ``show_n`` flag."""
    fs = style["font_pt"] - 2
    for i, lv in enumerate(levels):
        n = counts.get(lv, 0)
        if horizontal:
            ax.annotate(f"n = {n}", (0, i), xycoords=("axes fraction", "data"),
                        xytext=(-4, 0), textcoords="offset points",
                        ha="right", va="center", fontsize=fs,
                        color="#94a3b8", annotation_clip=False)
        else:
            ax.annotate(f"n = {n}", (i, 0), xycoords=("data", "axes fraction"),
                        xytext=(0, -26), textcoords="offset points",
                        ha="center", fontsize=fs,
                        color="#94a3b8", annotation_clip=False)


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
        # Unlike the text labels, a legend is positioned by its loc/anchor at
        # draw time and ignores an artist transform, so the nudge can't be a
        # ScaledTranslation. Stash it; _apply_legend_offset (run once everything
        # is drawn, from figure_to_svg/_bytes) resolves the auto-placed position
        # and re-anchors the legend by the offset.
        fig._iris_legend_nudge = (
            leg, fig.transFigure if faceted else ax.transAxes, off)
    return leg


def _apply_legend_offset(fig) -> None:
    """Re-anchor a dragged legend (offsets['legend']) by its stored pixel offset.
    Assumes the canvas has already been drawn (by `_finalize_deferred`) so the
    auto ('best'/'outside') position is resolved: shift its lower-left by the
    offset (points → px, y flipped to the SVG/label convention) and express that
    as an anchor fraction. Pops the stash so it stays a no-op (and idempotent) on
    a second save."""
    nudge = fig.__dict__.pop("_iris_legend_nudge", None)
    if not nudge:
        return
    leg, anchor_trans, off = nudge
    bb = leg.get_window_extent()
    dx, dy = off[0] * fig.dpi / 72.0, -off[1] * fig.dpi / 72.0  # y up in display
    fx, fy = anchor_trans.inverted().transform((bb.x0 + dx, bb.y0 + dy))
    leg._loc = (float(fx), float(fy))     # 2-tuple loc = lower-left in the anchor


def _apply_beeswarm(fig) -> None:
    """Pack each registered dot lane so its marks no longer overlap (the swarm
    layout). Deferred to here because seaborn's `Beeswarm` solver works in pixel
    space and needs the final axis transform; assumes the canvas has already been
    drawn (by `_finalize_deferred`). Mirrors `_apply_legend_offset`: pops its
    stash so a second save is a no-op.

    A lane's sub-series collections (the split by shape marker × discrete colour)
    are packed *jointly* — concatenated into one solve — so the silhouette
    reflects the whole group, not each sub-series in isolation. We replicate the
    transform → solve → writeback wrapper `Beeswarm.__call__` does for one
    collection, extended across a lane's collections, and reuse the solver's
    maintained core (`beeswarm`, `add_gutters`). Only the categorical coordinate
    is rewritten; point counts and ordering are untouched, so every gid still maps
    to the same row_ids (click-to-exclude survives)."""
    lanes = fig.__dict__.pop("_iris_beeswarm", None)
    if not lanes:
        return
    from seaborn.categorical import Beeswarm, _get_transform_functions
    dpi = fig.dpi
    for lane in lanes:
        ax, orient, center = lane["ax"], lane["orient"], lane["center"]
        colls = lane["collections"]
        cat_idx = 1 if orient == "y" else 0
        # Gather every sub-series point into one array, recording each
        # collection's slice so the solved positions can be sliced back. Per-point
        # radii are computed per collection so the size channel is honoured.
        slices, offsets, radii, start = [], [], [], 0
        for coll in colls:
            xy = np.asarray(coll.get_offsets(), dtype=float).copy()
            n = xy.shape[0]
            slices.append((start, start + n))
            if n:
                xy[:, cat_idx] = center           # reset to the lane centre
                sizes = coll.get_sizes()
                if sizes.size == 1:
                    sizes = np.repeat(sizes, n)
                edge = coll.get_linewidth().item()
                offsets.append(xy)
                radii.append((np.sqrt(sizes) + edge) / 2 * (dpi / 72))
                start += n
        if start <= 1:                            # empty / single-point lane: no-op
            continue
        orig_xy_data = np.concatenate(offsets, axis=0)
        radii = np.concatenate(radii)
        # To pixel space with the categorical axis first (seaborn's convention),
        # then sort by the value axis, solve, and unsort.
        orig_xy = ax.transData.transform(orig_xy_data)
        if orient == "y":
            orig_xy = orig_xy[:, [1, 0]]
        orig_xy = np.c_[orig_xy, radii]
        sorter = np.argsort(orig_xy[:, 1])
        bee = Beeswarm(orient=orient, width=lane["width"])
        new_xyr = np.empty_like(orig_xy)
        new_xyr[sorter] = bee.beeswarm(orig_xy[sorter])
        new_xy = new_xyr[:, [1, 0]] if orient == "y" else new_xyr[:, :2]
        cat_solved = ax.transData.inverted().transform(new_xy)[:, cat_idx].copy()
        # Clamp a dense lane to its gutter so it stops at the lane edge rather than
        # bleeding into the neighbour. Iris has no notices channel, so suppress the
        # solver's overflow warning and clamp silently (flat-edged dense lane).
        t_fwd, t_inv = _get_transform_functions(ax, orient)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            bee.add_gutters(cat_solved, center, t_fwd, t_inv)
        # Write the solved categorical coordinate back per collection, keeping the
        # value coordinate exactly as drawn.
        for coll, (s, e) in zip(colls, slices):
            if e <= s:
                continue
            xy = np.asarray(coll.get_offsets(), dtype=float).copy()
            xy[:, cat_idx] = cat_solved[s:e]
            coll.set_offsets(xy)


def _finalize_deferred(fig) -> None:
    """Resolve all draw-time-deferred layout work in one pass before a save. The
    beeswarm solve and the legend re-anchor both need final transforms, so draw
    the canvas once, run both, then freeze the layout engine so the save doesn't
    relayout the result away. Each pass pops its own stash, so this is a no-op on
    a second save."""
    pending = (getattr(fig, "_iris_beeswarm", None)
               or "_iris_legend_nudge" in fig.__dict__)
    if not pending:
        return
    fig.canvas.draw()
    _apply_beeswarm(fig)
    _apply_legend_offset(fig)
    fig.set_layout_engine("none")


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
    if family == "timeseries":
        return build_timeseries_figure(df, schema, spec, stats, level_tables)
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
    levels (restricted to those present in the data) first, then any present
    values the schema doesn't declare (sorted), so the schema controls ordering
    but no value living in the data is silently dropped from the axis — e.g.
    relaxing a filter brings rows back and they must reappear as their own box.
    Replaces stats["levels"] now that the figure is stats-independent."""
    if not cat_col or cat_col not in df.columns:
        return []
    sch = next((c for c in schema["columns"] if c["name"] == cat_col), None)
    present = set(df[cat_col].dropna().astype(str).unique())
    declared = [lv for lv in ((sch.get("levels") if sch else None) or []) if lv in present]
    extra = sorted(present - set(declared))
    return declared + extra


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
    sc = scales if scales is not None else scales_mod.resolve_scales(
        enc, df[df[val_col].notna()] if val_col in df else df, schema, style)
    # A colour ≠ x splits each x group into dodged sub-marks (a second factor).
    # A plain categorical colour always dodges. An identifier (a replicate id
    # like `date`) is discrete too, but a per-point geom claims it for the
    # superplot idiom — colouring each row's mark in place, no dodge — so an
    # identifier colour only dodges when no per-point layer is present (e.g. a box
    # on its own: each x group splits into one box per id). A numeric colour is a
    # colormap and never dodges.
    has_point = any(not geoms_mod.GEOMS[l["geom"]].aggregates
                    for l in spec.get("layers", [])
                    if l.get("geom") in geoms_mod.GEOMS)
    dodged = (color_col is not None and color_col != cat_col
              and not sc.color_numeric
              and (_is_categorical(schema, color_col) or not has_point))

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
    # a discrete colour that isn't dodged and isn't the x grouping (an
    # identifier/replicate id) colours each dot per-row instead of splitting the
    # group into sub-columns. When colour just follows x it is constant within a
    # group, so the uniform group-colour path is used (keeping the marker-reuse
    # <use> SVG the click-to-exclude contract relies on).
    cat_color_col = (layout["color_col"]
                     if (layout["color_col"] and not sc.color_numeric
                         and not layout["dodged"]
                         and layout["color_col"] != layout["cat_col"]) else None)
    ys = rows[val_col].to_numpy(dtype=float) if val_col in rows else np.array([])
    if "row_ids" in rows:
        point_ids = [list(r) for r in rows["row_ids"].tolist()]
    else:
        point_ids = [[i] for i in rows["id"].tolist()]
    return {"pos": pos, "lv": lv, "ys": ys, "color": color,
            "point_ids": point_ids,
            "keys": rows["id"].tolist() if "id" in rows else list(range(len(ys))),
            "summary": stats_mod._summary(lv, ys),
            **_aes_arrays(rows, sc, num_color_col, cat_color_col)}


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
    width = (_param(params, "mark_width", style, "mark_width") or 0.6) * ctx["wscale"]
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
    that make n visible — coloured by group, or per-grain when colour maps a
    discrete column that survives the grain (e.g. date colouring per-date dots);
    the numeric size/colour per-row channels stay bypassed (a coarse mark is an
    aggregate). Each mark carries the chained raw row-ids of everything it
    aggregates, so excluding it drops the whole unit.

    Per-layer `marker_size` and `alpha` params let a raw layer be faint/small and
    an aggregate layer bold/large within one composed figure."""
    params = layer.get("params") or {}
    style = ctx["style"]
    scales = ctx["scales"]
    h = ctx["h_orient"]
    layout = _param(params, "layout", style, "layout")
    jitter = _param(params, "jitter", style, "jitter") * ctx["wscale"]
    msize = _param(params, "marker_size", style, "marker_size")
    malpha = _param(params, "alpha", style, "marker_alpha")
    point_group, idx = [], ctx["gid_start"]
    for grp in ctx["groups"]:
        ys, point_ids, keys = grp["ys"], grp["point_ids"], grp["keys"]
        # swarm draws every mark at the lane centre and defers the no-overlap
        # packing to the final-draw solve (_apply_beeswarm); jitter offsets each
        # mark along the categorical axis by its stable level-row id so a redraw
        # keeps points put (y in horizontal mode).
        if layout == "swarm":
            cat_pos = np.full(len(ys), grp["pos"])
        else:
            cat_pos = grp["pos"] + np.array([_stable_jitter(k, jitter) for k in keys]) \
                if len(ys) else np.array([])
        lane_colls = []
        cvals, svals, shvals = grp.get("cvals"), grp.get("svals"), grp.get("shvals")
        ccols = grp.get("ccols")
        # Sub-series split first by shape marker, then (for a discrete per-point
        # colour) by colour level. Each (marker × colour) sub-series is a single
        # scatter call with a uniform marker+colour, so matplotlib renders it as
        # reusable <use> glyphs — keeping the gid → row-ids per-point click/exclude
        # contract that breaks if one call carries per-point colours.
        shape_series = ([(scales.marker_for(lv), np.flatnonzero(shvals == lv))
                         for lv in scales.shape_levels]
                        if shvals is not None
                        else [("o", np.arange(len(ys)))])
        sub_series = []
        for marker, sel in shape_series:
            if ccols is not None:
                for col in dict.fromkeys(ccols[i] for i in sel):  # first-seen order
                    csel = np.array([i for i in sel if ccols[i] == col], dtype=int)
                    sub_series.append((marker, col, csel))
            else:
                sub_series.append((marker, None, sel))
        for marker, color, sel in sub_series:
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
                # `color` is the sub-series' discrete swatch (per-grain colouring)
                # or None to fall back to the group colour.
                coll = ax.scatter(px, py,
                                  color=color if color is not None else grp["color"],
                                  **common)
            gid = f"pts-{idx}"
            coll.set_gid(gid)
            # row_ids[k] is the chained raw-id list behind the k-th drawn point
            point_group.append({"gid": gid,
                                "row_ids": [point_ids[k] for k in sel]})
            lane_colls.append(coll)
            idx += 1
        # All of a group's (marker × colour) sub-series pack jointly against each
        # other in one lane, so the silhouette reflects the whole group, not each
        # sub-series in isolation. Stash for the deferred pixel-space solve, which
        # needs the final axis transform (mirrors fig._iris_legend_nudge).
        if layout == "swarm" and lane_colls:
            fig = ax.figure
            if not hasattr(fig, "_iris_beeswarm"):
                fig._iris_beeswarm = []
            fig._iris_beeswarm.append(
                {"ax": ax, "collections": lane_colls, "center": grp["pos"],
                 "orient": "y" if h else "x", "width": 0.8 * ctx["wscale"]})
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
        raw_df, _ = hierarchy_mod.resolve_level(level_tables, hierarchy_mod.RAW)
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
                if style["show_n"]:
                    raw_cell = _facet_cell_df(raw_df, row_col, col_col, rlevel, clevel)
                    if val_col in raw_cell.columns:
                        raw_cell = raw_cell[raw_cell[val_col].notna()]
                    counts = raw_cell[cat_col].astype(str).value_counts().to_dict()
                    _draw_n_labels(ax, counts, levels, h, style)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                cbar_mappable = ctx.get("cbar_mappable") or cbar_mappable
                last_ax = ax

        # Significance brackets read the inferential result. Faceted figures are
        # describe-only (no test), so brackets only apply to the single-axes case.
        if not faceted and style["show_significance"]:
            _draw_significance(last_ax, stats, layout["levels"],
                               layout["h_orient"], style)

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


def _layer_param(layer: dict, key: str):
    """A timeseries layer param, falling back to the geom's registry default so a
    legacy spec (or a layer that omits a param) renders with the declared
    defaults rather than None."""
    g = geoms_mod.GEOMS.get(layer["geom"])
    default = g.params.get(key) if g else None
    v = (layer.get("params") or {}).get(key)
    return v if v is not None else default


def _geom_line(ax, rows, spine, x, y, sc, style, layer):
    """One thin, light curve per trajectory unit (the spaghetti). Units come from
    the spine (`trajectory_units`), NOT an aesthetic: with the default cell spine
    and x=frame, one curve per cell. Each curve is sorted by x ascending; a
    missing x leaves a break. Colour styles how curves look per `color` level
    (the legend names conditions, not units) and never decides which rows form a
    line. Aggregates no rows but emits no gid tags, so (like box/violin) its
    curves are not click-to-exclude targets — returns an empty point-group."""
    alpha = _layer_param(layer, "alpha")
    lw = _layer_param(layer, "linewidth")
    color_col = sc.color_col if (sc.color_col and not sc.color_numeric) else None
    split = [color_col] if color_col else []
    units = hierarchy_mod.trajectory_units(rows, spine, x, split)
    groups = (rows.groupby(units, observed=True, sort=False) if units
              else [(None, rows)])
    for _, g in groups:
        g = g.dropna(subset=[x, y]).sort_values(x)
        if len(g) < 2:
            continue
        color = (sc.color_for(str(g[color_col].iloc[0])) if color_col
                 else _group_color(style, 0))
        ax.plot(g[x].to_numpy(dtype=float), g[y].to_numpy(dtype=float),
                color=color, lw=lw, alpha=alpha, zorder=2)
    return []


def _geom_trend(ax, rows, x, y, sc, style, layer):
    """Mean ± spread band per `color` level over the ordered x. Groups RAW rows by
    x value — averaging across every unit at each timepoint — exactly the
    keep-frame/collapse-cell aggregation the prefix-grain model can't express, done
    internally here as `summary` does per category. The band (when `show_band`) is
    drawn first so the mean line sits on top; the half-spread reuses `_err_half`
    with the layer's `error_type` (ci95/sem/sd)."""
    error_type = _layer_param(layer, "error_type")
    show_band = _layer_param(layer, "show_band")
    color_col = sc.color_col if (sc.color_col and not sc.color_numeric) else None
    levels = sc.color_levels if color_col else [None]
    for lv in levels:
        sub = rows if lv is None else rows[rows[color_col].astype(str) == lv]
        sub = sub[[x, y]].dropna()
        if not len(sub):
            continue
        color = sc.color_for(lv) if color_col else _group_color(style, 0)
        xs, means, errs = [], [], []
        for xv, grp in sub.groupby(x, observed=True, sort=True):
            s = stats_mod._summary(str(xv), grp[y].to_numpy(dtype=float))
            xs.append(float(xv))
            means.append(s["mean"])
            errs.append(_err_half(s, error_type))
        xs, means, errs = np.array(xs), np.array(means), np.array(errs)
        if show_band:
            ax.fill_between(xs, means - errs, means + errs, color=color,
                            alpha=0.2, linewidth=0, zorder=1)
        ax.plot(xs, means, color=color, linewidth=style["line_width"], zorder=3)
    return []


def build_timeseries_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict,
                            level_tables: dict | None = None):
    """A measure over an ordered numeric x. Modeled on build_scatter_figure
    (numeric x/y axes, faceting via _build_grid, one shared legend) but the marks
    connect points across x: a `line` layer draws one per-unit trajectory (units
    from the spine), a `trend` layer draws the mean ± band over units per
    timepoint. Both bind to the raw rows — `trend` aggregates across units
    internally by x; `line` needs raw per-(unit, x) rows — so `level_tables` is
    unused here (the timeseries path never grain-collapses). The layered
    spaghetti+mean figure is just a `line` layer under a `trend` layer.

    Describe-only: no inferential test, so no annotation or significance bracket.
    Returns (fig, []) — no per-point click targets (see _geom_line)."""
    x = spec["encodings"]["x"]["column"]
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    layers = [l for l in spec.get("layers", []) if l["geom"] in ("line", "trend")]
    rows = df[df[x].notna() & df[y].notna()]
    sc_global = scales_mod.resolve_scales(spec["encodings"], rows, schema, style)
    hier = spec.get("hierarchy") or {}
    spine = hierarchy_mod.spine_present(df, hier.get("spine") or [])
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}

    with plt.rc_context(_rc(style)):
        fig, axes = _build_grid(style["width_mm"], style["height_mm"],
                                len(row_levels), len(col_levels),
                                sharex=facet_cfg.get("share_x", True),
                                sharey=facet_cfg.get("share_y", True))
        last_ax = None
        for ri, rlevel in enumerate(row_levels):
            for ci, clevel in enumerate(col_levels):
                ax = axes[ri][ci]
                cell_rows = _facet_cell_df(rows, row_col, col_col, rlevel, clevel)
                for layer in layers:
                    if layer["geom"] == "line":
                        _geom_line(ax, cell_rows, spine, x, y, sc_global, style, layer)
                    else:
                        _geom_trend(ax, cell_rows, x, y, sc_global, style, layer)
                if not faceted:
                    ax.set_xlabel(_axis_label(cols, x))
                    ax.set_ylabel(_axis_label(cols, y))
                _apply_axes(ax, style, x_numeric=True,
                            grid_x_default=False, grid_y_default=True)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                last_ax = ax

        if faceted:
            style["x_label"] = style["x_label"] or _axis_label(cols, x)
            style["y_label"] = style["y_label"] or _axis_label(cols, y)
        _draw_legend(fig, last_ax, sc_global, style, x, faceted=faceted)
        _decorate(fig, last_ax, style, faceted=faceted)
    return fig, []


_SINH_SHARPNESS = 3.0


def _sinh_bin_edges(lo: float, hi: float, bins: int,
                    sharpness: float = _SINH_SHARPNESS) -> np.ndarray:
    """`bins + 1` histogram edges over `[lo, hi]`, spaced tighter near x=0.

    Edges are uniform in `asinh(k·x)` space and mapped back through `sinh` (with
    `k = sharpness / max(|lo|, |hi|)`); since `d/dx asinh(k·x)` peaks at x=0, the
    narrowest value-bins land at zero and widen toward the extremes — resolution
    where signed data crosses its null point. `sharpness → 0` (or a degenerate /
    non-bracketing range) reduces to uniform edges. The real `[lo, hi]` is
    preserved, so an asymmetric span wastes no bins."""
    bins = max(int(bins), 1)
    if not (hi > lo):
        return np.linspace(lo, lo + 1.0, bins + 1)
    scale = max(abs(lo), abs(hi))
    k = (sharpness / scale) if (scale > 0 and sharpness > 0) else 0.0
    if k <= 0.0:
        return np.linspace(lo, hi, bins + 1)
    edges = np.sinh(np.linspace(np.arcsinh(k * lo), np.arcsinh(k * hi), bins + 1)) / k
    # Pin the ends exactly (the asinh/sinh round-trip can drift by a float ulp),
    # so np.histogram never drops a sample sitting on the boundary.
    edges[0], edges[-1] = lo, hi
    return edges


def _resolve_dist_bins(params: dict, style: dict, vals):
    """The bins= argument for np.histogram: a numpy strategy name
    (fd/scott/sturges/sqrt/auto), an int when bin_method is "fixed", or an explicit
    edge array when "sinh" (sinh-spaced over *vals*' range, tighter near zero). A
    legacy fixed hist_bins (set before bin_method existed, via a layer param or the
    old style override) still applies when no explicit method is chosen."""
    method = params.get("bin_method")
    fixed = _param(params, "hist_bins", style, "hist_bins")
    if method == "sinh":
        count = int(fixed) if fixed else 30
        sharpness = params.get("bin_sharpness")
        if sharpness is None:
            sharpness = _SINH_SHARPNESS
        return _sinh_bin_edges(float(np.min(vals)), float(np.max(vals)), count, sharpness)
    if method == "fixed" or (method in (None, "auto") and fixed):
        return int(fixed) if fixed else "auto"
    return method or "auto"


def _kde_curve(ax, vals, scale: float, color: str, style: dict, zorder: int):
    """A gaussian KDE of vals, scaled to the count axis (scale = N·binwidth so
    the curve overlays the bars at comparable height)."""
    from scipy.stats import gaussian_kde
    grid = np.linspace(vals.min(), vals.max(), 200)
    kde = gaussian_kde(vals)(grid)
    ax.plot(grid, kde * scale, color=color,
            linewidth=style["line_width"] * 0.93, zorder=zorder)


def _draw_distribution(ax, vals, params: dict, style: dict):
    """Draw one cell's distribution per the layer's `dist_render`:
    bars/step/line/points are binned views (counts per bin); "smooth" is a KDE
    curve only; "potential" Boltzmann-inverts the histogram to U(x) = −ln P (the
    log-density, empty bins dropped). `overlay_smooth` adds a KDE on top of a
    binned render. Mutates ax; aggregates rows, so there are no per-point click
    targets."""
    render = params.get("dist_render", "bars")
    color = _group_color(style, 0)
    counts, edges = np.histogram(vals, bins=_resolve_dist_bins(params, style, vals))
    centers = (edges[:-1] + edges[1:]) / 2
    binwidth = edges[1] - edges[0]
    smooth_ok = len(vals) > 2 and np.ptp(vals) > 0

    if render == "potential":
        # U(x) = −ln P over occupied bins only — P=0 ⇒ U=∞, so empty bins are
        # dropped (no −ln(0)). U≥0 always; let the axis autoscale rather than
        # ground at 0, so the well minimum (the feature of interest) shows.
        occ = counts > 0
        u = -np.log(counts[occ] / counts.sum())
        ax.plot(centers[occ], u, color=color, marker="o", markersize=4,
                linewidth=style["line_width"], zorder=2)
        return

    if render == "smooth":
        if smooth_ok:
            _kde_curve(ax, vals, len(vals) * binwidth, color, style, zorder=2)
        else:  # too few / degenerate points for a KDE — fall back to bars
            render = "bars"

    if render == "bars":
        ax.hist(vals, bins=edges, color=color, alpha=0.65,
                edgecolor="white", linewidth=0.5, zorder=2)
    elif render == "step":
        ax.hist(vals, bins=edges, color=color, histtype="step",
                linewidth=style["line_width"], zorder=2)
    elif render == "line":
        ax.plot(centers, counts, color=color,
                linewidth=style["line_width"], zorder=2)
    elif render == "points":
        ax.plot(centers, counts, color=color, marker="o", linestyle="none",
                markersize=4, zorder=2)

    if render in ("line", "points", "smooth"):
        ax.set_ylim(bottom=0)  # ground the count axis as bars would
    if params.get("overlay_smooth") and render != "smooth" and smooth_ok:
        _kde_curve(ax, vals, len(vals) * binwidth, INK, style, zorder=3)


def build_histogram_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Distribution of one numeric column (mapped on y). The `distribution`
    layer's render mode picks bars/step/line/points or a "smooth" KDE; an
    `overlay_smooth` param adds a KDE curve over a binned render. Aggregates
    rows, so there are no per-point click targets.

    Phase 4: when faceted, draws one cell per (row level × col level), each
    with its own marks/KDE/median recomputed from that cell's own values."""
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    alpha = stats.get("alpha", 0.05)
    layers = spec.get("layers", [])
    dist_params = next((l.get("params", {}) for l in layers
                        if l["geom"] == "distribution"), {})
    # The potential render swaps the count axis for U(x) = −ln P; every other
    # render is a count view.
    count_label = "−ln P" if dist_params.get("dist_render") == "potential" else "Count"
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
                if len(vals):
                    _draw_distribution(ax, vals, dist_params, style)

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
                    ax.set_ylabel(count_label)
                _apply_axes(ax, style, x_numeric=True,
                            grid_x_default=False, grid_y_default=True)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                last_ax = ax

        if faceted:
            style["x_label"] = style["x_label"] or _axis_label(cols, y)
            style["y_label"] = style["y_label"] or count_label
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
    _finalize_deferred(fig)
    buf = io.StringIO()
    fig.savefig(buf, format="svg")
    return buf.getvalue()


def figure_to_bytes(fig, fmt: str, dpi: int = 300) -> bytes:
    _finalize_deferred(fig)
    buf = io.BytesIO()
    fig.savefig(buf, format=fmt, dpi=dpi)
    return buf.getvalue()


def close(fig):
    plt.close(fig)
