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
import numpy as np
import pandas as pd

MM = 1 / 25.4
PALETTE = ["#0e7490", "#c2410c", "#4d7c0f", "#7c3aed"]
INK = "#0f172a"

STYLE_PRESETS = {
    "demo_default": {"width_mm": 140, "height_mm": 100, "font_pt": 9},
    "nature_single_column": {"width_mm": 89, "height_mm": 70, "font_pt": 7},
    "nature_double_column": {"width_mm": 183, "height_mm": 100, "font_pt": 7},
}


def _rc(font_pt: float) -> dict:
    return {
        "svg.fonttype": "none",          # real text in SVG (editable, selectable)
        "pdf.fonttype": 42,              # TrueType in PDF (editable in Illustrator)
        "font.family": "sans-serif",
        "font.size": font_pt,
        "axes.titlesize": font_pt,
        "axes.labelsize": font_pt,
        "xtick.labelsize": font_pt - 1,
        "ytick.labelsize": font_pt - 1,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.linewidth": 0.8,
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
    preset = dict(STYLE_PRESETS.get(style.get("preset"), STYLE_PRESETS["demo_default"]))
    for k, v in (style.get("overrides") or {}).items():
        if k == "font_size_pt":
            preset["font_pt"] = v
        elif k in preset:
            preset[k] = v
    return preset


def build_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Dispatch on the stats family. Returns (fig, point_groups);
    point_groups maps SVG gids to row ids in draw order, so the frontend can
    wire click-to-exclude per point (empty for aggregate-only figures)."""
    family = spec["stats"]["family"]
    if family == "correlation":
        return build_scatter_figure(df, schema, spec, stats)
    if family == "descriptive":
        return build_histogram_figure(df, schema, spec, stats)
    return build_comparison_figure(df, schema, spec, stats)


def build_comparison_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Group comparison; spec.layers picks the marks (dot, box, violin, bar,
    summary), which compose: e.g. box + dot overlays points on the boxes."""
    x = spec["mappings"]["x"]["column"]
    y = spec["mappings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    p_sig = stats["result"]["p"] < stats.get("alpha", 0.05)
    marks = {layer["mark"] for layer in spec.get("layers", [])} or {"dot", "summary"}

    with plt.rc_context(_rc(style["font_pt"])):
        fig, ax = plt.subplots(
            figsize=(style["width_mm"] * MM, style["height_mm"] * MM),
            layout="constrained")
        levels = stats["levels"]
        point_groups = []
        top = -np.inf

        for gi, lv in enumerate(levels):
            rows = df[(df[x] == lv) & df[y].notna()]
            ys = rows[y].to_numpy(dtype=float)
            color = PALETTE[gi % len(PALETTE)]
            s = next(s for s in stats["summaries"] if s["group"] == lv)
            if len(ys):
                top = max(top, ys.max(), s["mean"] + s["ci95_half"])

            if "violin" in marks and len(ys) > 1:
                vp = ax.violinplot([ys], positions=[gi], widths=0.7,
                                   showextrema=False)
                for body in vp["bodies"]:
                    body.set_facecolor(color)
                    body.set_alpha(0.22)
                    body.set_edgecolor(color)
                    body.set_linewidth(0.8)
                    body.set_zorder(1)
            if "box" in marks and len(ys):
                line = dict(color="#475569", linewidth=0.9)
                ax.boxplot([ys], positions=[gi], widths=0.42,
                           showfliers="dot" not in marks,
                           boxprops=line, whiskerprops=line, capprops=line,
                           medianprops=dict(color=INK, linewidth=1.3),
                           flierprops=dict(marker="o", markersize=3,
                                           markerfacecolor=color,
                                           markeredgecolor="none"),
                           zorder=2)
            if "bar" in marks:
                ax.bar(gi, s["mean"], width=0.6, color=color, alpha=0.55,
                       zorder=1)
                ax.errorbar(gi, s["mean"], yerr=s["ci95_half"], fmt="none",
                            ecolor=INK, elinewidth=1.2, capsize=3, zorder=3)

            if "dot" in marks:
                xs = gi + np.array([_stable_jitter(rid) for rid in rows["id"]])
                sc = ax.scatter(xs, ys, s=22, color=color,
                                alpha=0.55, linewidths=0.6, edgecolors="white",
                                zorder=3)
                gid = f"pts-{gi}"
                sc.set_gid(gid)
                point_groups.append({"gid": gid, "row_ids": rows["id"].tolist()})

            if "summary" in marks:
                cx = gi + 0.28
                ax.errorbar(cx, s["mean"], yerr=s["ci95_half"], fmt="none",
                            ecolor=INK, elinewidth=1.4, capsize=3, zorder=4)
                ax.plot(cx, s["mean"], marker="D", ms=5, color=INK, zorder=5)

        if p_sig:
            yr = ax.get_ylim()
            h = top + (yr[1] - yr[0]) * 0.08
            tick = (yr[1] - yr[0]) * 0.02
            ax.plot([0, 0, 1, 1], [h, h + tick, h + tick, h],
                    color=INK, lw=1.1, zorder=5)
            p = stats["result"]["p"]
            label = "***" if p < 0.001 else "**" if p < 0.01 else "*"
            ax.text(0.5, h + tick * 1.4, label, ha="center", va="bottom",
                    color=INK)
            ax.set_ylim(yr[0], max(yr[1], h + tick * 5))

        ax.set_xticks(range(len(levels)))
        labels = cols.get(x, {}).get("labels", {}) or {}
        ax.set_xticklabels([labels.get(lv, lv) for lv in levels])
        ax.set_xlim(-0.55, len(levels) - 0.45)
        ax.set_ylabel(cols.get(y, {}).get("label", y))
        ax.grid(axis="y", color="#e2e8f0", lw=0.6, zorder=0)
        ax.set_axisbelow(True)
        for s, lv in zip(stats["summaries"], levels):
            ax.annotate(f"n = {s['n']}", (levels.index(lv), 0),
                        xycoords=("data", "axes fraction"),
                        xytext=(0, -26), textcoords="offset points",
                        ha="center", fontsize=style["font_pt"] - 2,
                        color="#94a3b8", annotation_clip=False)
    return fig, point_groups


def _axis_label(cols: dict, name: str) -> str:
    return cols.get(name, {}).get("label", name)


def build_scatter_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Scatter of two numeric columns; the `regression` layer adds the OLS
    line and 95% CI band computed by the stats module."""
    x = spec["mappings"]["x"]["column"]
    y = spec["mappings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    marks = {layer["mark"] for layer in spec.get("layers", [])} or {"scatter",
                                                                    "regression"}
    rows = df[df[x].notna() & df[y].notna()]

    with plt.rc_context(_rc(style["font_pt"])):
        fig, ax = plt.subplots(
            figsize=(style["width_mm"] * MM, style["height_mm"] * MM),
            layout="constrained")

        reg = stats.get("regression")
        if "regression" in marks and reg:
            grid = np.asarray(reg["grid"])
            ax.fill_between(grid, reg["lo"], reg["hi"], color=PALETTE[0],
                            alpha=0.15, linewidth=0, zorder=1)
            ax.plot(grid, reg["intercept"] + reg["slope"] * grid,
                    color=PALETTE[0], linewidth=1.4, zorder=2)

        sc = ax.scatter(rows[x].to_numpy(dtype=float),
                        rows[y].to_numpy(dtype=float),
                        s=22, color=PALETTE[0], alpha=0.55,
                        linewidths=0.6, edgecolors="white", zorder=3)
        sc.set_gid("pts-0")
        point_groups = [{"gid": "pts-0", "row_ids": rows["id"].tolist()}]

        r = stats["result"]
        symbol = "r" if r["test"] == "pearson" else "ρ"
        p_txt = "p < 0.001" if r["p"] < 0.001 else f"p = {r['p']:.3f}"
        ax.text(0.02, 0.98, f"{symbol} = {r['r']:.2f}, {p_txt}",
                transform=ax.transAxes, ha="left", va="top",
                fontsize=style["font_pt"] - 1, color=INK)

        ax.set_xlabel(_axis_label(cols, x))
        ax.set_ylabel(_axis_label(cols, y))
        ax.grid(color="#e2e8f0", lw=0.6, zorder=0)
        ax.set_axisbelow(True)
    return fig, point_groups


def build_histogram_figure(df: pd.DataFrame, schema: dict, spec: dict, stats: dict):
    """Histogram of one numeric column (mapped on y); the `density` layer
    overlays a KDE curve scaled to the count axis. Bars aggregate rows, so
    there are no per-point click targets."""
    y = spec["mappings"]["y"]["column"]
    cols = {c["name"]: c for c in schema["columns"]}
    style = resolve_style(spec)
    marks = {layer["mark"] for layer in spec.get("layers", [])} or {"histogram"}
    vals = df[y].dropna().to_numpy(dtype=float)

    with plt.rc_context(_rc(style["font_pt"])):
        fig, ax = plt.subplots(
            figsize=(style["width_mm"] * MM, style["height_mm"] * MM),
            layout="constrained")
        counts, edges, _ = ax.hist(vals, bins="auto", color=PALETTE[0],
                                   alpha=0.65, edgecolor="white",
                                   linewidth=0.5, zorder=2)

        if "density" in marks and len(vals) > 2 and np.ptp(vals) > 0:
            from scipy.stats import gaussian_kde
            grid = np.linspace(vals.min(), vals.max(), 200)
            kde = gaussian_kde(vals)(grid)
            binwidth = edges[1] - edges[0]
            ax.plot(grid, kde * len(vals) * binwidth, color=INK,
                    linewidth=1.3, zorder=3)

        med = stats["result"]["median"]
        ax.axvline(med, color="#475569", linewidth=1.0, linestyle=(0, (4, 2)),
                   zorder=4)
        ax.text(med, ax.get_ylim()[1], f" median = {med:.2f}", ha="left",
                va="top", fontsize=style["font_pt"] - 1, color="#475569")

        ax.set_xlabel(_axis_label(cols, y))
        ax.set_ylabel("Count")
        ax.grid(axis="y", color="#e2e8f0", lw=0.6, zorder=0)
        ax.set_axisbelow(True)
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
