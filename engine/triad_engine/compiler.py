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
import matplotlib.pyplot as plt
import matplotlib.transforms as mtransforms
import numpy as np
import pandas as pd

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


def _decorate(fig, ax, style: dict, extra: dict | None = None):
    """Title/label text overrides, gid tags for draggable labels, and the
    drag offsets the frontend wrote back into the style (SVG px, y down —
    matplotlib points run y up, hence the sign flip)."""
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


def build_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Dispatch on the inferred stat_model family. Returns (fig, point_groups);
    point_groups maps SVG gids to row ids in draw order, so the frontend can
    wire click-to-exclude per point (empty for aggregate-only figures)."""
    family = spec["stat_model"]["family"]
    if family == "correlation":
        return build_scatter_figure(df, schema, spec, stats)
    if family == "descriptive":
        return build_histogram_figure(df, schema, spec, stats)
    return build_comparison_figure(df, schema, spec, stats)


def _param(params: dict, key: str, style: dict, style_key: str):
    """A layer param wins over the global style; falling back to style keeps
    legacy specs (which carry no params) pixel-identical to today."""
    v = params.get(key)
    return v if v is not None else style[style_key]


def _comparison_context(df, schema, spec, stats):
    x = spec["encodings"]["x"]["column"]
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    levels = stats["levels"]
    has_dots = any(l["geom"] == "dot" for l in spec.get("layers", []))
    groups, top = [], -np.inf
    for gi, lv in enumerate(levels):
        rows = df[(df[x] == lv) & df[y].notna()]
        ys = rows[y].to_numpy(dtype=float)
        s = next(s for s in stats["summaries"] if s["group"] == lv)
        err = _err_half(s, style["error_type"])
        if len(ys):
            top = max(top, ys.max(), s["mean"] + err)
        groups.append({"gi": gi, "lv": lv, "ys": ys,
                       "row_ids": rows["id"].tolist(),
                       "color": _group_color(style, gi), "summary": s})
    p = stats["result"].get("p")  # absent in the describe-only path → no bracket
    return {"x": x, "y": y, "cols": cols, "style": style, "levels": levels,
            "groups": groups, "has_dots": has_dots, "lw": style["line_width"],
            "top": top, "p_sig": p is not None and p < stats.get("alpha", 0.05)}


def _geom_violin(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    width = _param(params, "mark_width", style, "mark_width") or 0.7
    for grp in ctx["groups"]:
        ys = grp["ys"]
        if len(ys) <= 1:
            continue
        vp = ax.violinplot([ys], positions=[grp["gi"]], widths=width,
                           showextrema=False)
        for body in vp["bodies"]:
            body.set_facecolor(grp["color"]); body.set_alpha(0.22)
            body.set_edgecolor(grp["color"]); body.set_linewidth(lw * 0.6)
            body.set_zorder(1)
    return None


def _geom_box(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    width = _param(params, "mark_width", style, "mark_width") or 0.42
    show_fliers = not ctx["has_dots"] and style["outlier_marker"] != "none"
    line = dict(color="#475569", linewidth=lw * 0.65)
    for grp in ctx["groups"]:
        ys = grp["ys"]
        if not len(ys):
            continue
        ax.boxplot([ys], positions=[grp["gi"]], widths=width,
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


def _geom_bar(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    error_type = _param(params, "error_type", style, "error_type")
    width = style["mark_width"] or 0.6
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        ax.bar(grp["gi"], s["mean"], width=width, color=grp["color"],
               alpha=0.55, zorder=1)
        ax.errorbar(grp["gi"], s["mean"], yerr=err, fmt="none", ecolor=INK,
                    elinewidth=lw * 0.85, capsize=style["capsize"], zorder=3)
    return None


def _geom_dot(ax, ctx, params):
    style = ctx["style"]
    jitter = _param(params, "jitter", style, "jitter")
    point_group = None
    for grp in ctx["groups"]:
        xs = grp["gi"] + np.array([_stable_jitter(rid, jitter)
                                   for rid in grp["row_ids"]])
        sc = ax.scatter(xs, grp["ys"], s=style["marker_size"],
                        color=grp["color"], alpha=style["marker_alpha"],
                        linewidths=0.6, edgecolors="white", zorder=3)
        gid = f"pts-{grp['gi']}"
        sc.set_gid(gid)
        point_group = point_group or []
        point_group.append({"gid": gid, "row_ids": grp["row_ids"]})
    return point_group


def _geom_summary(ax, ctx, params):
    style, lw = ctx["style"], ctx["lw"]
    error_type = _param(params, "error_type", style, "error_type")
    for grp in ctx["groups"]:
        s = grp["summary"]
        err = _err_half(s, error_type)
        cx = grp["gi"] + 0.28
        ax.errorbar(cx, s["mean"], yerr=err, fmt="none", ecolor=INK,
                    elinewidth=lw, capsize=style["capsize"], zorder=4)
        ax.plot(cx, s["mean"], marker="D", ms=5, color=INK, zorder=5)
    return None


_COMPARISON_GEOMS = {"violin": _geom_violin, "box": _geom_box, "bar": _geom_bar,
                     "dot": _geom_dot, "summary": _geom_summary}


def build_comparison_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Group comparison rendered as ordered geom layers; each layer draws with
    its own params (falling back to the global style)."""
    ctx = _comparison_context(df, schema, spec, stats)
    style, levels = ctx["style"], ctx["levels"]

    with plt.rc_context(_rc(style)):
        fig, ax = plt.subplots(
            figsize=(style["width_mm"] * MM, style["height_mm"] * MM),
            layout="constrained")
        point_groups = []
        for layer in spec.get("layers", []):
            render = _COMPARISON_GEOMS.get(layer["geom"])
            if render is None:
                continue
            pg = render(ax, ctx, layer.get("params") or {})
            if pg:
                point_groups.extend(pg)

        if ctx["p_sig"] and style["show_significance"]:
            yr = ax.get_ylim()
            h = ctx["top"] + (yr[1] - yr[0]) * 0.08
            tick = (yr[1] - yr[0]) * 0.02
            ax.plot([0, 0, 1, 1], [h, h + tick, h + tick, h],
                    color=INK, lw=1.1, zorder=5)
            p = stats["result"]["p"]
            label = "***" if p < 0.001 else "**" if p < 0.01 else "*"
            ax.text(0.5, h + tick * 1.4, label, ha="center", va="bottom",
                    color=INK)
            ax.set_ylim(yr[0], max(yr[1], h + tick * 5))

        ax.set_xticks(range(len(levels)))
        labels = ctx["cols"].get(ctx["x"], {}).get("labels", {}) or {}
        ax.set_xticklabels([labels.get(lv, lv) for lv in levels])
        ax.set_xlim(-0.55, len(levels) - 0.45)
        ax.set_ylabel(ctx["cols"].get(ctx["y"], {}).get("label", ctx["y"]))
        _apply_axes(ax, style, x_numeric=False,
                    grid_x_default=False, grid_y_default=True)
        if style["show_n"]:
            for s, lv in zip(stats["summaries"], levels):
                ax.annotate(f"n = {s['n']}", (levels.index(lv), 0),
                            xycoords=("data", "axes fraction"),
                            xytext=(0, -26), textcoords="offset points",
                            ha="center", fontsize=style["font_pt"] - 2,
                            color="#94a3b8", annotation_clip=False)
        _decorate(fig, ax, style)
    return fig, point_groups


def _axis_label(cols: dict, name: str) -> str:
    return cols.get(name, {}).get("label", name)


def build_scatter_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Scatter of two numeric columns; the `regression` layer adds the OLS
    line and 95% CI band computed by the stats module."""
    x = spec["encodings"]["x"]["column"]
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    marks = {layer["geom"] for layer in spec.get("layers", [])} or {"scatter",
                                                                    "regression"}
    rows = df[df[x].notna() & df[y].notna()]
    color = _group_color(style, 0)

    with plt.rc_context(_rc(style)):
        fig, ax = plt.subplots(
            figsize=(style["width_mm"] * MM, style["height_mm"] * MM),
            layout="constrained")

        reg = stats.get("regression")
        if "regression" in marks and reg:
            grid = np.asarray(reg["grid"])
            ax.fill_between(grid, reg["lo"], reg["hi"], color=color,
                            alpha=0.15, linewidth=0, zorder=1)
            ax.plot(grid, reg["intercept"] + reg["slope"] * grid,
                    color=color, linewidth=style["line_width"], zorder=2)

        sc = ax.scatter(rows[x].to_numpy(dtype=float),
                        rows[y].to_numpy(dtype=float),
                        s=style["marker_size"], color=color,
                        alpha=style["marker_alpha"],
                        linewidths=0.6, edgecolors="white", zorder=3)
        sc.set_gid("pts-0")
        point_groups = [{"gid": "pts-0", "row_ids": rows["id"].tolist()}]

        extra = {}
        if style["show_annotation"] and stats["result"].get("r") is not None:
            r = stats["result"]
            symbol = "r" if r["test"] == "pearson" else "ρ"
            p_txt = "p < 0.001" if r["p"] < 0.001 else f"p = {r['p']:.3f}"
            extra["lbl-annot"] = ax.text(
                0.02, 0.98, f"{symbol} = {r['r']:.2f}, {p_txt}",
                transform=ax.transAxes, ha="left", va="top",
                fontsize=style["font_pt"] - 1, color=INK)

        ax.set_xlabel(_axis_label(cols, x))
        ax.set_ylabel(_axis_label(cols, y))
        _apply_axes(ax, style, x_numeric=True,
                    grid_x_default=True, grid_y_default=True)
        _decorate(fig, ax, style, extra=extra)
    return fig, point_groups


def build_histogram_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Histogram of one numeric column (mapped on y); the `density` layer
    overlays a KDE curve scaled to the count axis. Bars aggregate rows, so
    there are no per-point click targets."""
    y = spec["encodings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    layers = spec.get("layers", [])
    marks = {layer["geom"] for layer in layers} or {"histogram"}
    hist_params = next((l.get("params", {}) for l in layers
                        if l["geom"] == "histogram"), {})
    vals = df[y].dropna().to_numpy(dtype=float)

    with plt.rc_context(_rc(style)):
        fig, ax = plt.subplots(
            figsize=(style["width_mm"] * MM, style["height_mm"] * MM),
            layout="constrained")
        bins_val = _param(hist_params, "hist_bins", style, "hist_bins")
        bins = int(bins_val) if bins_val else "auto"
        counts, edges, _ = ax.hist(vals, bins=bins, color=_group_color(style, 0),
                                   alpha=0.65, edgecolor="white",
                                   linewidth=0.5, zorder=2)

        if "density" in marks and len(vals) > 2 and np.ptp(vals) > 0:
            from scipy.stats import gaussian_kde
            grid = np.linspace(vals.min(), vals.max(), 200)
            kde = gaussian_kde(vals)(grid)
            binwidth = edges[1] - edges[0]
            ax.plot(grid, kde * len(vals) * binwidth, color=INK,
                    linewidth=style["line_width"] * 0.93, zorder=3)

        med = stats["result"]["median"]
        extra = {}
        if style["show_annotation"]:
            ax.axvline(med, color="#475569", linewidth=style["line_width"] * 0.7,
                       linestyle=(0, (4, 2)), zorder=4)
            extra["lbl-annot"] = ax.text(
                med, ax.get_ylim()[1], f" median = {med:.2f}", ha="left",
                va="top", fontsize=style["font_pt"] - 1, color="#475569")

        ax.set_xlabel(_axis_label(cols, y))
        ax.set_ylabel("Count")
        _apply_axes(ax, style, x_numeric=True,
                    grid_x_default=False, grid_y_default=True)
        _decorate(fig, ax, style, extra=extra)
    return fig, []


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
