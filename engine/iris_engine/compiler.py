"""Compile an analysis spec to a matplotlib figure.

Dots/scatter draw as plain vector marks: points are not individually clickable
(item I removed click-to-select from the figure), so the compiler emits no
per-point gids or point_groups and colour is vectorized into one scatter call
per marker rather than split per colour level.
Draggable artists (title, axis labels, the r/p annotation, the legend) still
carry their own stable gids — see `_decorate`.

WYSIWYG rule: the figure is laid out at its physical size (mm). The SVG sent
to the screen and the exported SVG/PDF come from the same renderer at the
same size; PNG only adds rasterization DPI.
"""
from __future__ import annotations

import io
import warnings
import zlib

from dataclasses import replace

import matplotlib
matplotlib.use("Agg")
import matplotlib.lines as mlines
import matplotlib.pyplot as plt
import matplotlib.transforms as mtransforms
import numpy as np
import pandas as pd
from matplotlib import cbook, mlab

from . import geoms as geoms_mod
from . import hierarchy as hierarchy_mod
from . import scales as scales_mod
from . import stats as stats_mod
from . import style as style_mod
from .scales import PALETTE  # the single colour source of truth (see scales.py)

MM = 1 / 25.4
INK = "#0f172a"

# Re-export from style.py — the single source of truth for defaults.
STYLE_DEFAULTS = style_mod.STYLE_DEFAULTS


# Output-time rcParams. `svg.fonttype`/`pdf.fonttype` are read by savefig, not at
# draw time, so they must wrap the savefig call — not `_rc` (which only governs the
# figure-building rc_context). Set here, text stays real <text>/TrueType (editable,
# selectable) instead of being outlined to paths.
_OUTPUT_RC = {
    "svg.fonttype": "none",          # real text in SVG (editable, selectable)
    "pdf.fonttype": 42,              # TrueType in PDF (editable in Illustrator)
}


def _rc(style: dict) -> dict:
    font_pt = style["font_pt"]
    closed = style["frame"] == "closed"
    x_side = style["x_tick_side"]
    y_side = style["y_tick_side"]
    x_top = x_side == "top"
    y_right = y_side == "right"
    # item O: tick mirroring is now an independent control. "both" always mirrors;
    # a closed frame still DEFAULTS to mirrored ticks (the publication-box look)
    # unless the user explicitly picked a single side, in which case the side knob
    # is authoritative — so a closed frame can carry one-sided ticks and an open
    # frame can carry mirrored ticks. Mirrored ticks need no extra spine: on an
    # open frame the far-side ticks float at the axis edge with no spine line.
    x_both = x_side == "both" or (closed and not style.get("_x_tick_side_set"))
    y_both = y_side == "both" or (closed and not style.get("_y_tick_side_set"))
    return {
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
        # Ticks: mirror when x_both/y_both (see above), otherwise on the chosen
        # side. Labels always stay on the primary side only, so a mirrored axis
        # never shows duplicate tick labels.
        "xtick.bottom": x_both or not x_top, "xtick.top": x_both or x_top,
        "xtick.labelbottom": not x_top, "xtick.labeltop": x_top,
        "ytick.left": y_both or not y_right, "ytick.right": y_both or y_right,
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


resolve_style = style_mod.resolve_style
resolve_geom_style = style_mod.resolve_geom_style


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
    lim = ax.get_xlim() if horizontal else ax.get_ylim()
    # Never anchor beyond the visible axis: if the value axis is pinned (y_max/
    # x_max) below the drawn data, an outlier is clipped, so the bracket/star
    # belongs at the visible top, not floating off-canvas at the clipped value.
    if np.isfinite(v):
        return min(float(v), float(lim[1]))
    return float(lim[1])


def _pinned_value_range(ax, horizontal: bool, style: dict) -> tuple[float, float]:
    """The value-axis (lo, hi) the figure will actually show: the style-pinned
    x_min/x_max (or y_min/y_max) where set, else the current axis limits. The
    pins are applied later in `_decorate`, so significance placement must read
    them here to space + clamp against the final view, not the unclipped data."""
    lo, hi = ax.get_xlim() if horizontal else ax.get_ylim()
    pmin = style["x_min"] if horizontal else style["y_min"]
    pmax = style["x_max"] if horizontal else style["y_max"]
    return (float(pmin) if pmin is not None else float(lo),
            float(pmax) if pmax is not None else float(hi))


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

    lo, hi = _pinned_value_range(ax, horizontal, style)
    base = min(_drawn_value_max(ax, horizontal), hi)
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


_SUBSCRIPT = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def _n_label(counts_per_grain: list[int]) -> str:
    """Compose one x-level's sample-size label from its per-grain counts, ordered
    FINEST→COARSEST. One grain → ``n = R`` (the replicate count, today's label);
    two → ``n = R  N = U`` (replicates and units, the superplot pair); more →
    indexed ``n₀ = …  n₁ = …`` finest-first so deeper nesting stays unambiguous."""
    if len(counts_per_grain) == 1:
        return f"n = {counts_per_grain[0]}"
    if len(counts_per_grain) == 2:
        return f"n = {counts_per_grain[0]}  N = {counts_per_grain[1]}"
    return "  ".join(f"n{str(i).translate(_SUBSCRIPT)} = {c}"
                     for i, c in enumerate(counts_per_grain))


def _draw_n_labels(ax, count_dicts: list[dict], levels: list, horizontal: bool,
                   style: dict) -> None:
    """One faint sample-size label per x-level, anchored just outside the value
    axis (below a vertical plot, left of a horizontal one). ``count_dicts`` is one
    count map per distinct grain the layers draw at, FINEST→COARSEST; each maps a
    level name to that grain's group count within the level. Toggled by
    ``show_n``."""
    if not count_dicts:
        return
    fs = style["font_pt"] - 2
    for i, lv in enumerate(levels):
        txt = _n_label([cd.get(lv, 0) for cd in count_dicts])
        if horizontal:
            ax.annotate(txt, (0, i), xycoords=("axes fraction", "data"),
                        xytext=(-4, 0), textcoords="offset points",
                        ha="right", va="center", fontsize=fs,
                        color="#94a3b8", annotation_clip=False)
        else:
            ax.annotate(txt, (i, 0), xycoords=("data", "axes fraction"),
                        xytext=(0, -26), textcoords="offset points",
                        ha="center", fontsize=fs,
                        color="#94a3b8", annotation_clip=False)


_REF_DASHES = {"dashed": (0, (5, 4)), "solid": "-", "dotted": (0, (1, 2))}


def _draw_reference_line(ax, value, label, horizontal: bool, style: dict) -> None:
    """A faint reference line on the VALUE axis at `value` (chance/control/unity).
    Vertical plot → value axis is Y → axhline; horizontal → axvline. Drawn below
    the marks (zorder 1, above the grid). Skipped on a log value axis when
    `value <= 0` (can't place a non-positive value on a log scale)."""
    if value is None:
        return
    value = float(value)
    value_log = (ax.get_xscale() == "log") if horizontal else (ax.get_yscale() == "log")
    if value_log and value <= 0:
        return
    ls = _REF_DASHES.get(style.get("reference_line_style", "dashed"), _REF_DASHES["dashed"])
    color = "#94a3b8"   # the same faint ink-grey as the n labels
    fs = style["font_pt"] - 2
    if horizontal:
        ax.axvline(value, color=color, linestyle=ls, lw=1.0, zorder=1)
        if label:
            ax.annotate(label, (value, 1), xycoords=("data", "axes fraction"),
                        xytext=(2, -3), textcoords="offset points",
                        ha="left", va="top", fontsize=fs, color=color,
                        annotation_clip=False)
    else:
        ax.axhline(value, color=color, linestyle=ls, lw=1.0, zorder=1)
        if label:
            ax.annotate(label, (1, value), xycoords=("axes fraction", "data"),
                        xytext=(-2, 2), textcoords="offset points",
                        ha="right", va="bottom", fontsize=fs, color=color,
                        annotation_clip=False)


def _draw_location_significance(ax, res: dict, levels: list, horizontal: bool,
                                style: dict) -> None:
    """One-sample (location family) significance: a compact star per LANE just
    above that lane's drawn data, marking each group's test against the reference.
    No brackets or arches — the comparison is group-vs-constant, not lane-to-lane.
    Reads ``res['per_group']`` (one entry per group, carrying its ``stars``)."""
    per = {str(g["level"]): g.get("stars") for g in (res or {}).get("per_group", [])
           if g.get("stars")}
    if not per:
        return
    lo, hi = _pinned_value_range(ax, horizontal, style)
    # The style value-axis cap is applied later (in _decorate), so clamp here too,
    # else a clipped outlier anchors the star off-canvas above a pinned axis.
    base = min(_drawn_value_max(ax, horizontal), hi)
    extent = (hi - lo) or 1.0
    step = extent * 0.06
    fs = style["font_pt"] - 1
    v = base + step
    for i, lv in enumerate(levels):
        lbl = per.get(str(lv))
        if not lbl:
            continue
        if horizontal:
            ax.text(v, i, lbl, ha="left", va="center", fontsize=fs, clip_on=False)
        else:
            ax.text(i, v, lbl, ha="center", va="bottom", fontsize=fs, clip_on=False)
    headroom = v + step
    if horizontal:
        if style["x_max"] is None:
            ax.set_xlim(right=max(ax.get_xlim()[1], headroom))
    elif style["y_max"] is None:
        ax.set_ylim(top=max(ax.get_ylim()[1], headroom))


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

    # Plot-area drag/resize: pin the axes to an explicit figure-fraction rect.
    # Deferred to _finalize_deferred (like the legend nudge) so constrained
    # layout solves first and is then frozen; only meaningful with one axes.
    rect = style.get("axes_rect")
    if not faceted:
        # Tag the axes background so the frontend can locate the plot-area
        # rectangle and overlay its move/resize handles (gid 'plot-area').
        ax.patch.set_gid("plot-area")
        if rect and len(rect) == 4:
            fig._iris_axes_rect = (ax, [float(v) for v in rect])


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
            if e["channel"] == "color+shape":
                # Item J: color and shape share this metric — one handle shows the
                # colored marker shape together, so the block has one row per label.
                h = mlines.Line2D([], [], marker=sw["marker"], linestyle="none",
                                  color=sw["color"], markersize=6)
            elif e["channel"] == "shape":
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


def _apply_axes_rect(fig) -> None:
    """Pin the plot area to its dragged/resized rect (offsets['axes_rect'] →
    [left, bottom, width, height] in figure fractions). Run from
    _finalize_deferred after constrained layout has solved and the legend has
    been re-anchored, with the layout engine about to be frozen, so the explicit
    position survives the save. Pops its stash, so a second save is a no-op."""
    stash = fig.__dict__.pop("_iris_axes_rect", None)
    if not stash:
        return
    ax, box = stash
    ax.set_position(box)


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

    A lane's sub-series collections (the split by shape marker) are packed
    *jointly* — concatenated into one solve — so the silhouette reflects the whole
    group, not each sub-series in isolation. We replicate the transform → solve →
    writeback wrapper `Beeswarm.__call__` does for one collection, extended across
    a lane's collections, and reuse the solver's maintained core (`beeswarm`,
    `add_gutters`). Only the categorical coordinate is rewritten; point counts and
    ordering are untouched."""
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
               or "_iris_legend_nudge" in fig.__dict__
               or "_iris_axes_rect" in fig.__dict__)
    if not pending:
        return
    fig.canvas.draw()
    _apply_beeswarm(fig)
    _apply_legend_offset(fig)
    _apply_axes_rect(fig)
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


def _facet_levels(df: pd.DataFrame, spec: dict, schema: dict | None = None):
    """Phase 4: resolve (row_col, col_col, row_levels, col_levels) for the
    facet grid, restricted to levels actually present in the data. An
    unfaceted axis returns [None] so callers can loop uniformly with a single
    iteration — the unfaceted path is then just a 1×1 grid.

    Level order follows the column's declared `schema.levels` (as the x-axis
    does), so a meaningful facet order is not silently alphabetised; any present
    value not in the declared list is appended in sorted order, and a column with
    no declared levels keeps the alphabetical fallback. `schema` is optional so
    historical 2-arg callers are unaffected."""
    declared = {}
    for c in (schema or {}).get("columns", []):
        if c.get("levels"):
            declared[c["name"]] = list(c["levels"])

    def _ordered(colname):
        present = set(df[colname].dropna().astype(str).unique().tolist())
        order = declared.get(colname)
        if not order:
            return sorted(present)
        ranked = [lv for lv in order if lv in present]
        return ranked + sorted(present - set(order))

    facet = spec.get("facet") or {}
    row = facet.get("row")
    col = facet.get("col")
    row_col = row["column"] if row and row.get("column") else None
    col_col = col["column"] if col and col.get("column") else None
    row_levels = _ordered(row_col) if row_col and row_col in df else [None]
    col_levels = _ordered(col_col) if col_col and col_col in df else [None]
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
    """Dispatch on the inferred stat_model family. Returns the matplotlib figure.

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
            "cbar_mappable": None}


def _group(rows, lv, pos, color, layout):
    """One (x-level [× colour]) cell of a layer's level table → a group dict.
    `keys` are the per-mark row ids used only for the stable jitter offset."""
    val_col, sc = layout["val_col"], layout["scales"]
    num_color_col = layout["color_col"] if sc.color_numeric else None
    # a discrete colour that isn't dodged and isn't the x grouping (an
    # identifier/replicate id) colours each dot per-row instead of splitting the
    # group into sub-columns. When colour just follows x it is constant within a
    # group, so the uniform group-colour path is used.
    cat_color_col = (layout["color_col"]
                     if (layout["color_col"] and not sc.color_numeric
                         and not layout["dodged"]
                         and layout["color_col"] != layout["cat_col"]) else None)
    ys = rows[val_col].to_numpy(dtype=float) if val_col in rows else np.array([])
    return {"pos": pos, "lv": lv, "ys": ys, "color": color,
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


def _violin_kde(X, coords):
    """matplotlib's default violin KDE (Scott bandwidth); constant data → a spike."""
    X = np.asarray(X)
    if np.ptp(X) == 0:
        return (X[0] == coords).astype(float)
    return mlab.GaussianKDE(X, None).evaluate(coords)


def _geom_violin(ax, ctx, layer):
    style, lw = ctx["style"], ctx["lw"]
    gs = resolve_geom_style(style, "violin", layer.get("id"))
    h = ctx["h_orient"]
    width = (gs.get("mark_width") or 0.7) * ctx["wscale"]
    fill_alpha = gs.get("fill_alpha", 0.22)
    orient = "horizontal" if h else "vertical"
    # The value axis is x for horizontal violins, y otherwise. When it is log-scaled
    # the KDE must be estimated in log space: a bandwidth tuned to the bulk otherwise
    # draws a near-flat sliver across the small-value decades that the log axis
    # stretches into a long thin tail, cut off abruptly at the single smallest point.
    # Estimate the density on log10(value) and map the violin coords back to data space.
    log_value = (style["x_scale"] if h else style["y_scale"]) == "log"
    for grp in ctx["groups"]:
        ys = np.asarray(grp["ys"], float)
        if log_value:
            ys = ys[ys > 0]
        if len(ys) <= 1 or np.ptp(ys) == 0:
            continue
        if log_value:
            vpstats = cbook.violin_stats(np.log10(ys), _violin_kde, points=200)
            for s in vpstats:
                s["coords"] = np.power(10.0, s["coords"])
                for k in ("mean", "median", "min", "max"):
                    s[k] = 10.0 ** s[k]
            vp = ax.violin(vpstats, positions=[grp["pos"]], widths=width,
                           orientation=orient, showextrema=False)
        else:
            vp = ax.violinplot([ys], positions=[grp["pos"]], widths=width,
                               orientation=orient, showextrema=False)
        for body in vp["bodies"]:
            body.set_facecolor(grp["color"]); body.set_alpha(fill_alpha)
            body.set_edgecolor(grp["color"]); body.set_linewidth(lw * 0.6)
            body.set_zorder(1)
    return None


def _geom_box(ax, ctx, layer):
    style, lw = ctx["style"], ctx["lw"]
    gs = resolve_geom_style(style, "box", layer.get("id"))
    h = ctx["h_orient"]
    width = (gs.get("mark_width") or 0.42) * ctx["wscale"]
    outlier_marker = gs.get("outlier_marker", "o")
    show_fliers = not ctx["has_dots"] and outlier_marker != "none"
    use_fill = gs.get("fill", False)
    fill_alpha = gs.get("fill_alpha", 0.25)
    line = dict(color="#475569", linewidth=lw * 0.65)
    # patch_artist turns boxes into Patch objects which need edgecolor, not color
    box_kw = dict(edgecolor="#475569", linewidth=lw * 0.65) if use_fill else line
    for grp in ctx["groups"]:
        ys = grp["ys"]
        if not len(ys):
            continue
        orient = "vertical" if not h else "horizontal"
        bp = ax.boxplot(
            [ys], positions=[grp["pos"]], widths=width,
            orientation=orient,
            patch_artist=use_fill,
            notch=gs.get("notch", False) and len(ys) > 5,
            showfliers=show_fliers,
            boxprops=box_kw, whiskerprops=line, capprops=line,
            medianprops=dict(color=INK, linewidth=lw * 0.93),
            flierprops=dict(marker=outlier_marker,
                            markersize=gs.get("outlier_size", 3.0),
                            markerfacecolor=grp["color"],
                            markeredgecolor=grp["color"],
                            markeredgewidth=0.8),
            zorder=2)
        if use_fill:
            for patch in bp["boxes"]:
                patch.set_facecolor(grp["color"])
                patch.set_alpha(fill_alpha)
    return None


def _geom_bar(ax, ctx, layer):
    style, lw = ctx["style"], ctx["lw"]
    gs = resolve_geom_style(style, "bar", layer.get("id"))
    h = ctx["h_orient"]
    error_type = gs.get("error_type", "ci95")
    width = (gs.get("mark_width") or 0.6) * ctx["wscale"]
    capsize = gs.get("capsize", 3.0)
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        if h:
            ax.barh(grp["pos"], s["mean"], height=width, color=grp["color"],
                    alpha=0.55, zorder=1)
            ax.errorbar(s["mean"], grp["pos"], xerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw * 0.85, capsize=capsize, zorder=3)
        else:
            ax.bar(grp["pos"], s["mean"], width=width, color=grp["color"],
                   alpha=0.55, zorder=1)
            ax.errorbar(grp["pos"], s["mean"], yerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw * 0.85, capsize=capsize, zorder=3)
    return None


def _geom_dot(ax, ctx, layer):
    """Dots for one layer's level table — one mark per row of that level. At the
    raw level this is one mark per observation, honouring the per-point color
    (numeric via colormap, or a discrete per-grain swatch), size, and shape
    channels. A mapped shape splits a group into one scatter call per marker
    (matplotlib can't vary the marker within a call); colour, by contrast, is
    vectorized — a numeric colour passes `c=values` through the colormap and a
    discrete per-grain colour passes a per-point RGBA array, so each marker is one
    scatter call regardless of how many colours it carries. At a coarser level it
    is one prominent mark per grain (e.g. one per date) — the superplot's "big
    marks" that make n visible — coloured by group, or per-grain when colour maps
    a discrete column that survives the grain; the numeric size/colour per-row
    channels stay bypassed (a coarse mark is an aggregate).

    Dots are not individually clickable (item I), so no gids or point_groups are
    emitted. Per-layer `marker_size` and `alpha` params let a raw layer be
    faint/small and an aggregate layer bold/large within one composed figure."""
    style = ctx["style"]
    gs = resolve_geom_style(style, "dot", layer.get("id"))
    scales = ctx["scales"]
    h = ctx["h_orient"]
    layout = gs.get("layout", "swarm")
    jitter = gs.get("jitter", 0.18) * ctx["wscale"]
    msize = gs.get("marker_size", 22.0)
    malpha = gs.get("alpha", 0.55)
    for grp in ctx["groups"]:
        ys, keys = grp["ys"], grp["keys"]
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
        # Split only by shape marker; colour stays vectorized within each marker.
        shape_series = ([(scales.marker_for(lv), np.flatnonzero(shvals == lv))
                         for lv in scales.shape_levels]
                        if shvals is not None
                        else [("o", np.arange(len(ys)))])
        for marker, sel in shape_series:
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
            elif ccols is not None:
                # discrete per-grain colour: one resolved swatch per point, passed
                # as a vectorized colour array (no per-colour sub-series split).
                coll = ax.scatter(px, py, c=[ccols[k] for k in sel], **common)
            else:
                coll = ax.scatter(px, py, color=grp["color"], **common)
            lane_colls.append(coll)
        # All of a group's (marker) sub-series pack jointly against each other in
        # one lane, so the silhouette reflects the whole group, not each sub-series
        # in isolation. Stash for the deferred pixel-space solve, which needs the
        # final axis transform (mirrors fig._iris_legend_nudge).
        if layout == "swarm" and lane_colls:
            fig = ax.figure
            if not hasattr(fig, "_iris_beeswarm"):
                fig._iris_beeswarm = []
            fig._iris_beeswarm.append(
                {"ax": ax, "collections": lane_colls, "center": grp["pos"],
                 "orient": "y" if h else "x", "width": 0.8 * ctx["wscale"]})
    return None


def _geom_summary(ax, ctx, layer):
    style, lw = ctx["style"], ctx["lw"]
    gs = resolve_geom_style(style, "summary", layer.get("id"))
    h = ctx["h_orient"]
    error_type = gs.get("error_type", "ci95")
    capsize = gs.get("capsize", 3.0)
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        cpos = grp["pos"] + ctx["summary_dx"]
        if h:
            ax.errorbar(s["mean"], cpos, xerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw, capsize=capsize, zorder=4)
            ax.plot(s["mean"], cpos, marker="D", ms=5, color=INK, zorder=5)
        else:
            ax.errorbar(cpos, s["mean"], yerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw, capsize=capsize, zorder=4)
            ax.plot(cpos, s["mean"], marker="D", ms=5, color=INK, zorder=5)
    return None


def _geom_pointrange(ax, ctx, layer):
    """Estimate ± CI, one point per group (item Q). For the `rate` family the
    point is the GLM rate estimate and the bar is its (asymmetric) model CI,
    colored by group; otherwise it falls back to a mean ± error of the raw
    values (so the geom is usable standalone, like `summary`)."""
    style, lw = ctx["style"], ctx["lw"]
    gs = resolve_geom_style(style, "pointrange", layer.get("id"))
    h, capsize = ctx["h_orient"], gs.get("capsize", 3.0)
    ms = gs.get("marker_size", 6.0)
    res = ctx.get("stats") or {}

    if res.get("family") == "rate":
        per = {str(g["level"]): g for g in res.get("per_group", [])}
        for i, lv in enumerate(ctx["levels"]):
            g = per.get(str(lv))
            if not g:
                continue
            est = g["rate"]
            lo, hi = (g["ci"] if g.get("ci") else (est, est))
            err = [[est - lo], [hi - est]]            # asymmetric model CI
            color = _group_color(style, i)
            if h:
                ax.errorbar(est, i, xerr=err, fmt="none", ecolor=color,
                            elinewidth=lw, capsize=capsize, zorder=4)
                ax.plot(est, i, marker="o", ms=ms, color=color, zorder=5)
            else:
                ax.errorbar(i, est, yerr=err, fmt="none", ecolor=color,
                            elinewidth=lw, capsize=capsize, zorder=4)
                ax.plot(i, est, marker="o", ms=ms, color=color, zorder=5)
        return None

    error_type = gs.get("error_type", "ci95")
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        cpos = grp["pos"] + ctx["summary_dx"]
        if h:
            ax.errorbar(s["mean"], cpos, xerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw, capsize=capsize, zorder=4)
            ax.plot(s["mean"], cpos, marker="o", ms=ms, color=INK, zorder=5)
        else:
            ax.errorbar(cpos, s["mean"], yerr=err, fmt="none", ecolor=INK,
                        elinewidth=lw, capsize=capsize, zorder=4)
            ax.plot(cpos, s["mean"], marker="o", ms=ms, color=INK, zorder=5)
    return None


_COMPARISON_GEOMS = {"violin": _geom_violin, "box": _geom_box, "bar": _geom_bar,
                     "dot": _geom_dot, "summary": _geom_summary,
                     "pointrange": _geom_pointrange}


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
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec, schema)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}
    layers = spec.get("layers", [])
    # Reference-line annotation (item N): an explicit `reference_value` knob, else
    # the location family's tested reference (authoring the one-sample test draws
    # the line). A general annotation drawn in every cell of the grid.
    is_location = (stats or {}).get("family") == "location"
    is_rate = (stats or {}).get("family") == "rate"
    ref_value = style.get("reference_value")
    if ref_value is None and is_location:
        ref_value = (stats or {}).get("reference")
    ref_label = style.get("reference_label") or ""
    # The value axis of a rate plot is an estimated rate (count per exposure), not
    # the raw count column — name it so unless the user pinned a label.
    val_label = layout["cols"].get(val_col, {}).get("label", val_col)
    if is_rate:
        expo = (stats or {}).get("exposure")
        val_label = f"rate ({val_col} / {expo})" if expo else f"rate ({val_col})"

    with plt.rc_context(_rc(style)):
        fig, axes = _build_grid(style["width_mm"], style["height_mm"],
                                len(row_levels), len(col_levels),
                                sharex=facet_cfg.get("share_x", True),
                                sharey=facet_cfg.get("share_y", True))
        cbar_mappable, last_ax = None, None
        levels, h = layout["levels"], layout["h_orient"]
        for ri, rlevel in enumerate(row_levels):
            for ci, clevel in enumerate(col_levels):
                ax = axes[ri][ci]
                ctx = {**layout, "cbar_mappable": None, "stats": stats}
                for layer in layers:
                    render = _COMPARISON_GEOMS.get(layer["geom"])
                    if render is None:
                        continue
                    ldf, _ = hierarchy_mod.resolve_level(level_tables, layer.get("level"))
                    cell_df = _facet_cell_df(ldf, row_col, col_col, rlevel, clevel)
                    ctx["groups"] = _groups(cell_df, layout)
                    render(ax, ctx, layer)

                cat_labels = layout["cols"].get(cat_col, {}).get("labels", {}) or {}
                lv_labels = [cat_labels.get(lv, lv) for lv in levels]
                if h:
                    ax.set_yticks(range(len(levels)))
                    ax.set_yticklabels(lv_labels)
                    ax.set_ylim(-0.55, len(levels) - 0.45)
                    if not faceted:
                        ax.set_xlabel(val_label)
                else:
                    ax.set_xticks(range(len(levels)))
                    ax.set_xticklabels(lv_labels)
                    ax.set_xlim(-0.55, len(levels) - 0.45)
                    if not faceted:
                        ax.set_ylabel(val_label)

                # for horizontal the value axis is X (numeric); grids follow accordingly
                _apply_axes(ax, style, x_numeric=h,
                            grid_x_default=h, grid_y_default=not h)
                if ref_value is not None:
                    _draw_reference_line(ax, ref_value, ref_label, h, style)
                if style["show_n"]:
                    # n reports one count per grain. By default these are only the
                    # grains the LAYERS draw at (item G's "only the drawn levels");
                    # `show_all_levels` (item M) instead reports every level of the
                    # hierarchy spine — drawn or not — so an intermediate level no
                    # layer is bound to still gets a count. An unknown/dropped layer
                    # level collapses to RAW; grains nest, so a finer one has more
                    # rows — order by table size, finest (most rows) → coarsest, for
                    # n / n,N / n₀…
                    if style.get("show_all_levels"):
                        grains = list(level_tables.keys())
                    else:
                        grains = []
                        for layer in layers:
                            if layer["geom"] not in _COMPARISON_GEOMS:
                                continue
                            lv = layer.get("level") or hierarchy_mod.RAW
                            if lv not in level_tables:
                                lv = hierarchy_mod.RAW
                            if lv not in grains:
                                grains.append(lv)
                    grains.sort(
                        key=lambda lv: len(hierarchy_mod.resolve_level(level_tables, lv)[0]),
                        reverse=True)
                    count_dicts = []
                    for lv in grains:
                        ldf, _ = hierarchy_mod.resolve_level(level_tables, lv)
                        cell = _facet_cell_df(ldf, row_col, col_col, rlevel, clevel)
                        if val_col in cell.columns:
                            cell = cell[cell[val_col].notna()]
                        count_dicts.append(
                            cell[cat_col].astype(str).value_counts().to_dict())
                    _draw_n_labels(ax, count_dicts, levels, h, style)
                if faceted:
                    title = _facet_title(row_col, col_col, rlevel, clevel)
                    if title:
                        ax.set_title(title, fontsize=style["font_pt"] - 1)
                cbar_mappable = ctx.get("cbar_mappable") or cbar_mappable
                last_ax = ax

        # Significance markers read the inferential result. Faceted figures are
        # describe-only (no test), so markers only apply to the single-axes case.
        # The location (one-sample) family draws a per-lane star against the
        # reference; every other family stacks lane-to-lane brackets.
        # The rate family draws no significance markers — the inference is the
        # global LR test (in methods_text) plus the visible per-group CIs.
        if not faceted and style["show_significance"] and not is_rate:
            if is_location:
                _draw_location_significance(last_ax, stats, layout["levels"],
                                            layout["h_orient"], style)
            else:
                _draw_significance(last_ax, stats, layout["levels"],
                                   layout["h_orient"], style)

        cbar = sc_global.colorbar_spec()
        if cbar:
            cbar_ax = axes.ravel().tolist() if faceted else last_ax
            _draw_colorbar(fig, cbar_ax, cbar_mappable, style, cbar["label"])
        if faceted:
            if h:
                style["x_label"] = style["x_label"] or val_label
            else:
                style["y_label"] = style["y_label"] or val_label
        _draw_legend(fig, last_ax, sc_global, style, cat_col, faceted=faceted)
        _decorate(fig, last_ax, style, faceted=faceted)
    return fig


def _axis_label(cols: dict, name: str) -> str:
    return cols.get(name, {}).get("label", name)


def _draw_points(ax, rows, x, y, sc, style):
    """Per-point scatter honoring the color/size/shape scales. A mapped shape
    splits into one scatter call per marker (matplotlib can't vary the marker
    within a call); colour is vectorized — a numeric colour (Phase 3b) maps each
    point through the colormap (c=values + cmap), a discrete colour passes a
    per-point RGBA array, and an unmapped colour is one uniform swatch. With no
    color/shape mapped this is a single uniform scatter; size, when mapped, varies
    marker area per point.

    Dots are not individually clickable (item I), so no gids/point_groups are
    emitted. Returns the colorbar mappable (None unless a numeric colour is
    mapped, in which case it feeds the colorbar)."""
    gs = resolve_geom_style(style, "scatter")
    numeric_color = sc.color_col is not None and sc.color_numeric
    shape_levels = sc.shape_levels if sc.shape_col else [None]
    mappable = None
    for sl in shape_levels:
        sub = rows
        if sc.shape_col is not None:
            sub = sub[sub[sc.shape_col].astype(str) == sl]
        if not len(sub):
            continue
        marker = sc.marker_for(sl) if sc.shape_col else "o"
        size = ([sc.size_for(v) for v in sub[sc.size_col]] if sc.size_col
                else gs.get("marker_size", 22.0))
        common = dict(s=size, marker=marker, alpha=gs.get("alpha", 0.55),
                      linewidths=0.6, edgecolors="white", zorder=3)
        px = sub[x].to_numpy(dtype=float)
        py = sub[y].to_numpy(dtype=float)
        if numeric_color:
            mappable = ax.scatter(px, py,
                                  c=sub[sc.color_col].to_numpy(dtype=float),
                                  cmap=sc.color_cmap, vmin=sc.color_lo,
                                  vmax=sc.color_hi, **common)
        elif sc.color_col is not None:
            # discrete colour: one resolved swatch per point, vectorized.
            colors = [sc.color_for(v) for v in sub[sc.color_col].astype(str)]
            ax.scatter(px, py, c=colors, **common)
        else:
            ax.scatter(px, py, color=_group_color(style, 0), **common)
    return mappable


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
    legend_scale = sc_global
    color = _group_color(style, 0)
    gs_reg = resolve_geom_style(style, "regression")
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec, schema)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}

    with plt.rc_context(_rc(style)):
        fig, axes = _build_grid(style["width_mm"], style["height_mm"],
                                len(row_levels), len(col_levels),
                                sharex=facet_cfg.get("share_x", True),
                                sharey=facet_cfg.get("share_y", True))
        cbar_mappable, last_ax = None, None
        extra = {}
        for ri, rlevel in enumerate(row_levels):
            for ci, clevel in enumerate(col_levels):
                ax = axes[ri][ci]
                cell_rows = _facet_cell_df(rows, row_col, col_col, rlevel, clevel)
                cell_stats = (stats_mod.describe_pairs(cell_rows, x, y, alpha=alpha)
                              if faceted else stats)

                # Three regression renderings, all keeping the raw points drawn:
                #  • Stratified (categorical colour): one line + readout per
                #    colour group, in the group's palette colour (`per_group`).
                #  • Spined, no colour group: one within-replicate line per spine
                #    unit, points coloured by replicate, and the single
                #    across-replicate readout — the pooled fit (the
                #    pseudoreplication trap) is intentionally NOT drawn, so the
                #    picture matches the honest coefficient (`unit_regressions`).
                #  • Otherwise: the pooled line + pooled readout.
                # `per_group`/`unit_regressions` are only on the non-faceted stats.
                per_group = cell_stats.get("per_group") if not faceted else None
                unit_regs = cell_stats.get("unit_regressions") if not faceted else None
                spine_cols = ((cell_stats.get("result") or {}).get("unit")
                              if not faceted else None)
                sc_points = sc_global
                if per_group:
                    line_draws = [(g["level"], sc_global.color_for(g["level"]),
                                   g.get("regression")) for g in per_group]
                    annot_draws = [(g["level"], sc_global.color_for(g["level"]), g)
                                   for g in per_group]
                elif unit_regs:
                    levels = [u["level"] for u in unit_regs]
                    umap = {lv: _group_color(style, i) for i, lv in enumerate(levels)}
                    line_draws = [(u["level"], umap[u["level"]], u["regression"])
                                  for u in unit_regs]
                    annot_draws = [(None, INK, cell_stats["result"])]
                    # Colour the cells by replicate so they share the line palette
                    # (single-column spine; a compound spine falls back to plain).
                    if spine_cols and len(spine_cols) == 1 and spine_cols[0] in cell_rows:
                        sc_points = replace(sc_global, color_col=spine_cols[0],
                                            color_levels=list(levels),
                                            _color_map=dict(umap), color_numeric=False)
                        legend_scale = sc_points
                else:
                    line_draws = [(None, color, cell_stats.get("regression"))]
                    annot_draws = [(None, color, cell_stats["result"])]

                if "regression" in marks:
                    for _lv, _c, reg in line_draws:
                        if not reg:
                            continue
                        grid = np.asarray(reg["grid"])
                        if gs_reg.get("show_band", True):
                            ax.fill_between(grid, reg["lo"], reg["hi"], color=_c,
                                            alpha=0.15, linewidth=0, zorder=1)
                        ax.plot(grid, reg["intercept"] + reg["slope"] * grid,
                                color=_c, linewidth=style["line_width"], zorder=2)

                mappable = _draw_points(ax, cell_rows, x, y, sc_points, style)
                cbar_mappable = mappable or cbar_mappable

                if style["show_annotation"]:
                    line_i = 0
                    for _lv, _c, r in annot_draws:
                        if r.get("r") is None:
                            continue
                        symbol = "r" if r["test"] == "pearson" else "ρ"
                        p_txt = "p < 0.001" if r["p"] < 0.001 else f"p = {r['p']:.3f}"
                        label = f"{_lv}: " if _lv is not None else ""
                        txt = ax.text(
                            0.02, 0.98 - line_i * 0.07,
                            f"{label}{symbol} = {r['r']:.2f}, {p_txt}",
                            transform=ax.transAxes, ha="left", va="top",
                            fontsize=style["font_pt"] - 1,
                            color=_c if _lv is not None else INK)
                        line_i += 1
                        if not faceted and _lv is None:
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
        _draw_legend(fig, last_ax, legend_scale, style, x, faceted=faceted)
        _decorate(fig, last_ax, style, extra=extra, faceted=faceted)
    return fig


def _geom_line(ax, rows, spine, x, y, sc, style, layer):
    """One thin, light curve per trajectory unit (the spaghetti). Units come from
    the spine (`trajectory_units`), NOT an aesthetic: with the default cell spine
    and x=frame, one curve per cell. Each curve is sorted by x ascending; a
    missing x leaves a break. Colour styles how curves look per `color` level
    (the legend names conditions, not units) and never decides which rows form a
    line."""
    gs = resolve_geom_style(style, "line", layer.get("id"))
    alpha = gs.get("alpha", 0.35)
    lw = gs.get("linewidth", 0.8)
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


def _geom_trend(ax, rows, x, y, sc, style, layer):
    """Mean ± spread band per `color` level over the ordered x. Groups RAW rows by
    x value — averaging across every unit at each timepoint — exactly the
    keep-frame/collapse-cell aggregation the prefix-grain model can't express, done
    internally here as `summary` does per category. The band (when `show_band`) is
    drawn first so the mean line sits on top; the half-spread reuses `_err_half`
    with the layer's `error_type` (ci95/sem/sd)."""
    gs = resolve_geom_style(style, "trend", layer.get("id"))
    error_type = gs.get("error_type", "ci95")
    show_band = gs.get("show_band", True)
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

    Describe-only: no inferential test, so no annotation or significance bracket."""
    x = spec["encodings"]["x"]["column"]
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    layers = [l for l in spec.get("layers", []) if l["geom"] in ("line", "trend")]
    rows = df[df[x].notna() & df[y].notna()]
    sc_global = scales_mod.resolve_scales(spec["encodings"], rows, schema, style)
    hier = spec.get("hierarchy") or {}
    spine = hierarchy_mod.spine_present(df, hier.get("spine") or [])
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec, schema)
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
    return fig


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


def _resolve_dist_bins(gs: dict, vals):
    """The bins= argument for np.histogram: a numpy strategy name
    (fd/scott/sturges/sqrt/auto), an int when bin_method is "fixed", or an explicit
    edge array when "sinh" (sinh-spaced over *vals*' range, tighter near zero). A
    legacy fixed hist_bins still applies when no explicit method is chosen."""
    method = gs.get("bin_method")
    fixed = gs.get("hist_bins")
    if method == "sinh":
        count = int(fixed) if fixed else 30
        sharpness = gs.get("bin_sharpness")
        if sharpness is None:
            sharpness = _SINH_SHARPNESS
        return _sinh_bin_edges(float(np.min(vals)), float(np.max(vals)), count, sharpness)
    if method == "fixed" or (method in (None, "auto") and fixed):
        return int(fixed) if fixed else "auto"
    return method or "auto"


def _shared_dist_bins(gs: dict, pooled: np.ndarray) -> np.ndarray:
    """One explicit edge array computed from the POOLED in-scope values (all
    groups, all facet cells), so overlaid/faceted distribution curves share bins
    and are directly comparable (item P). For `sinh` the range is made SYMMETRIC
    about zero (`[-m, m]`, m = max|value|) — the signed reaction-coordinate
    convention; the per-cell `_sinh_bin_edges` stays range-faithful, the symmetric
    choice belongs to the shared scope. Other methods resolve their edges from the
    pooled values via numpy's bin-edge strategies."""
    if not len(pooled):
        return np.linspace(0.0, 1.0, 2)
    method = gs.get("bin_method")
    if method == "sinh":
        count = int(gs["hist_bins"]) if gs.get("hist_bins") else 30
        sharpness = gs.get("bin_sharpness")
        if sharpness is None:
            sharpness = _SINH_SHARPNESS
        m = float(np.max(np.abs(pooled))) or 1.0
        return _sinh_bin_edges(-m, m, count, sharpness)
    return np.histogram_bin_edges(pooled, bins=_resolve_dist_bins(gs, pooled))


def _kde_curve(ax, vals, scale: float, color: str, style: dict, zorder: int):
    """A gaussian KDE of vals, scaled to the count axis (scale = N·binwidth so
    the curve overlays the bars at comparable height)."""
    from scipy.stats import gaussian_kde
    grid = np.linspace(vals.min(), vals.max(), 200)
    kde = gaussian_kde(vals)(grid)
    ax.plot(grid, kde * scale, color=color,
            linewidth=style["line_width"] * 0.93, zorder=zorder)


def _draw_distribution(ax, vals, style: dict, *, edges=None, color=None):
    """Draw one cell/group's distribution per the geom's `dist_render`:
    bars/step/line/points are binned views (counts per bin); "smooth" is a KDE
    curve only; "potential" Boltzmann-inverts the histogram to U(x) = −ln P (the
    log-density, empty bins dropped). `overlay_smooth` adds a KDE on top of a
    binned render. Mutates ax; aggregates rows.

    Item P: `edges` (an explicit shared bin-edge array) and `color` (the group's
    palette color) override the per-cell bins / single palette index so several
    groups overlay on common bins. For the `potential` render the occupied-bin
    `(centers, u)` are returned so the caller can place the barrier annotation;
    every other render returns None."""
    gs = resolve_geom_style(style, "distribution")
    render = gs.get("dist_render", "bars")
    if color is None:
        color = _group_color(style, 0)
    bins = edges if edges is not None else _resolve_dist_bins(gs, vals)
    counts, edges = np.histogram(vals, bins=bins)
    centers = (edges[:-1] + edges[1:]) / 2
    binwidth = edges[1] - edges[0]
    smooth_ok = len(vals) > 2 and np.ptp(vals) > 0

    if render == "potential":
        occ = counts > 0
        u = -np.log(counts[occ] / counts.sum())
        ax.plot(centers[occ], u, color=color, marker="o", markersize=4,
                linewidth=style["line_width"], zorder=2)
        return centers[occ], u

    if render == "smooth":
        if smooth_ok:
            _kde_curve(ax, vals, len(vals) * binwidth, color, style, zorder=2)
        else:
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
        ax.set_ylim(bottom=0)
    if gs.get("overlay_smooth") and render != "smooth" and smooth_ok:
        _kde_curve(ax, vals, len(vals) * binwidth, INK, style, zorder=3)
    return None


def _annotate_potential_barrier(ax, centers, u, color: str, style: dict,
                                reference: float, index: int = 0) -> None:
    """Mark the wells and label the effective barrier of one potential curve
    (item P). `(centers, u)` are the occupied-bin centers + U = −ln P values
    returned by `_draw_distribution`'s potential render.

    ΔE = U(reference) − min(U), the engine analogue of CellFlow's
    `effective_barrier`: interpolate U at the central `reference` (default 0) and
    subtract the curve's global minimum. The two wells (the minima of U on each
    side of the reference) get a filled marker, and `ΔE = … kT` is labelled in the
    curve's color. Skipped cleanly (describe-note, no draw) when the reference is
    not bracketed by occupied bins — there is no barrier to read. `index` staggers
    the label vertically so grouped curves don't overprint."""
    centers = np.asarray(centers, dtype=float)
    u = np.asarray(u, dtype=float)
    if len(centers) < 2:
        return
    ref = float(reference if reference is not None else 0.0)
    if ref < centers.min() or ref > centers.max():
        return  # reference outside the occupied range — no bracketed barrier
    u_ref = float(np.interp(ref, centers, u))
    barrier = u_ref - float(np.min(u))
    # Wells: the minimum of U on each side of the reference.
    for side in (centers < ref, centers >= ref):
        if side.any():
            cs, us = centers[side], u[side]
            j = int(np.argmin(us))
            ax.plot([cs[j]], [us[j]], marker="o", markersize=6, color=color,
                    markeredgecolor="white", markeredgewidth=0.6, zorder=5)
    top = ax.get_ylim()[1]
    ax.annotate(f"ΔE = {barrier:.2f} kT", (ref, top),
                xytext=(3, -3 - index * (style["font_pt"] + 2)),
                textcoords="offset points", ha="left", va="top",
                fontsize=style["font_pt"] - 1, color=color, annotation_clip=False)


def build_histogram_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Distribution of one numeric column (mapped on y). The `distribution`
    layer's render mode picks bars/step/line/points or a "smooth" KDE; an
    `overlay_smooth` param adds a KDE curve over a binned render. Aggregates rows.

    Phase 4: when faceted, draws one cell per (row level × col level), each
    with its own marks/KDE/median recomputed from that cell's own values."""
    y = spec["encodings"]["y"]["column"]
    enc = spec["encodings"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    alpha = stats.get("alpha", 0.05)
    gs = resolve_geom_style(style, "distribution")
    render = gs.get("dist_render", "bars")
    count_label = "−ln P" if render == "potential" else "Count"
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec, schema)
    faceted = row_col is not None or col_col is not None
    facet_cfg = spec.get("facet") or {}

    # Item P: a categorical color overlays one curve per group in a single panel.
    # Numeric color is a colorbar, not curves, so only categorical color groups.
    color = enc.get("color")
    color_col = color["column"] if color and color.get("column") else None
    grouped = bool(color_col) and _is_categorical(schema, color_col)
    sc = scales_mod.resolve_scales(enc, df, schema, style)
    color_levels = sc.color_levels if grouped else []
    # Shared bins span the POOLED in-scope values so overlaid/faceted curves are
    # comparable; per-cell independent bins stay the default for a single panel.
    pooled = df[y].dropna().to_numpy(dtype=float)
    shared_edges = (_shared_dist_bins(gs, pooled)
                    if (grouped or faceted) and len(pooled) else None)
    show_barrier = bool(gs.get("show_barrier")) and render == "potential"
    barrier_ref = style["reference_value"] if style["reference_value"] is not None else 0.0

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
                if grouped:
                    for i, lv in enumerate(color_levels):
                        gvals = cell_df.loc[cell_df[color_col].astype(str) == lv, y]
                        gvals = gvals.dropna().to_numpy(dtype=float)
                        if not len(gvals):
                            continue
                        curve = _draw_distribution(ax, gvals, style,
                                                   edges=shared_edges,
                                                   color=sc.color_for(lv))
                        if show_barrier and curve is not None:
                            _annotate_potential_barrier(ax, *curve, sc.color_for(lv),
                                                         style, barrier_ref, i)
                else:
                    vals = cell_df[y].dropna().to_numpy(dtype=float)
                    if len(vals):
                        curve = _draw_distribution(ax, vals, style,
                                                   edges=shared_edges)
                        if show_barrier and curve is not None:
                            _annotate_potential_barrier(ax, *curve,
                                                         _group_color(style, 0),
                                                         style, barrier_ref)

                # The pooled median axvline reads a single distribution; over
                # overlaid group curves it is ambiguous, so it is only drawn
                # ungrouped (each group has its own distribution).
                cell_result = (stats_mod.descriptive(cell_df, y, alpha=alpha)
                              if faceted else stats)
                med = cell_result.get("result", {}).get("median")
                if style["show_annotation"] and not grouped and med is not None:
                    ax.axvline(med, color="#475569",
                              linewidth=style["line_width"] * 0.7,
                              linestyle=(0, (4, 2)), zorder=4)
                    txt = ax.text(
                        med, ax.get_ylim()[1], f" median = {med:.2f}", ha="left",
                        va="top", fontsize=style["font_pt"] - 1, color="#475569")
                    if not faceted:
                        extra["lbl-annot"] = txt

                # Standalone reference line (item N) — the reaction coordinate is
                # on X here, so a vertical line. Drawn when the user pins a value.
                if style["reference_value"] is not None:
                    _draw_reference_line(ax, style["reference_value"],
                                         style["reference_label"], True, style)

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
        # One shared legend names the overlaid groups (no x encoding to dedupe
        # against, so color always shows).
        if grouped:
            _draw_legend(fig, last_ax, sc, style, None, faceted=faceted)
        _decorate(fig, last_ax, style, extra=extra, faceted=faceted)
    return fig


def build_tile_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Phase 3d: tile/heatmap for categorical x × categorical y. Fill = count of
    rows in each (x_level, y_level) cell (aggregate).

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
    gs_tile = resolve_geom_style(style, "tile")
    tile_cmap = gs_tile.get("colormap", "Blues")
    tile_show_counts = gs_tile.get("show_counts", True)

    x_levels = stats["x_levels"]
    y_levels = stats["y_levels"]
    row_col, col_col, row_levels, col_levels = _facet_levels(df, spec, schema)
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
                im = (ax.imshow(counts, cmap=tile_cmap, aspect="auto",
                                origin="upper", vmin=0, vmax=vmax)
                      if faceted else
                      ax.imshow(counts, cmap=tile_cmap, aspect="auto", origin="upper"))

                ax.set_xticks(range(len(x_levels)))
                x_lbl = cols.get(x, {}).get("labels", {}) or {}
                ax.set_xticklabels([x_lbl.get(lv, lv) for lv in x_levels])

                ax.set_yticks(range(len(y_levels)))
                y_lbl = cols.get(y, {}).get("labels", {}) or {}
                ax.set_yticklabels([y_lbl.get(lv, lv) for lv in y_levels])

                if tile_show_counts and style["show_annotation"]:
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
    return fig


def figure_to_svg(fig) -> str:
    _finalize_deferred(fig)
    buf = io.StringIO()
    with plt.rc_context(_OUTPUT_RC):
        fig.savefig(buf, format="svg")
    return buf.getvalue()


def figure_to_bytes(fig, fmt: str, dpi: int = 300) -> bytes:
    _finalize_deferred(fig)
    buf = io.BytesIO()
    with plt.rc_context(_OUTPUT_RC):
        fig.savefig(buf, format=fmt, dpi=dpi)
    return buf.getvalue()


def close(fig):
    plt.close(fig)
