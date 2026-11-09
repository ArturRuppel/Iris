"""Multi-panel figures: several analyses of one document drawn as the panels of
ONE matplotlib figure.

A document may carry a figure assembly (``figure.json`` in the ``.iris``, see
document.py). An analysis joins the figure by having a ``tag`` ("A", "B", ...);
the tag is also the panel's letter. The assembly fixes the order and the layout::

    {"version": 1,
     "panels": ["<analysis id>", ...],      # order; tagged analyses not listed follow in document order
     "direction": "rows",                   # "rows": panels stacked top to bottom; "columns": side by side
     "sizes": null,                         # null: each panel's own size; or {"<analysis id>": weight}
     "gap_mm": 3.0,
     "letters": {"show": true, "size_pt": 10.0, "weight": "bold", "position": "outside"},
     "share_x": false,                      # rows only: one x range, x labels only on the bottom panel
     "width_mm": null, "height_mm": null}   # null: from the panels' own sizes

Each panel is drawn by the ordinary builder of its family (compiler.py) into its
own subfigure: ``compiler._PANEL_PARENT`` makes ``_build_grid`` hand out the
panel's subfigure instead of opening a new figure, and nothing else in the
builders changes. With the variable unset, a single analysis renders exactly as
before. After constrained layout has solved, the panels' axes are aligned (left
edges for stacked rows, bottoms for columns; with ``share_x`` both edges, so the
plot areas line up exactly) and the layout is frozen.

A build script renders a document's assembly with :func:`render_figure` (tables
and analyses as given to ``document.save_document``) or :func:`render_iris`
(the bytes of a saved ``.iris``)."""
from __future__ import annotations

import math

import matplotlib.pyplot as plt
import matplotlib.transforms as mtransforms

from . import compiler
from .style import STYLE_DEFAULTS

ASSEMBLY_VERSION = 1

LETTER_DEFAULTS = {"show": True, "size_pt": 10.0, "weight": "bold",
                   "position": "outside"}
DEFAULTS = {
    "version": ASSEMBLY_VERSION,
    "panels": [],
    "direction": "rows",
    "sizes": None,
    "gap_mm": 3.0,
    "letters": LETTER_DEFAULTS,
    "share_x": False,
    "width_mm": None,
    "height_mm": None,
}


class AssemblyError(ValueError):
    """The assembly cannot be drawn (no panels, a panel failed in strict mode)."""


def _num(v, lo=None, hi=None):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    if lo is not None and x < lo:
        return None
    if hi is not None and x > hi:
        return None
    return x


def normalize(figure: dict | None) -> dict | None:
    """The assembly with every field present and in range; ``None`` stays
    ``None`` (a document without a figure). Unknown keys are dropped, a bad
    value falls back to its default. Idempotent."""
    if figure is None:
        return None
    if not isinstance(figure, dict):
        raise AssemblyError("a figure assembly is an object")
    out = {**DEFAULTS, "letters": dict(LETTER_DEFAULTS)}
    panels = figure.get("panels")
    if isinstance(panels, list):
        seen, ids = set(), []
        for p in panels:
            if isinstance(p, str) and p and p not in seen:
                seen.add(p)
                ids.append(p)
        out["panels"] = ids
    if figure.get("direction") in ("rows", "columns"):
        out["direction"] = figure["direction"]
    sizes = figure.get("sizes")
    if isinstance(sizes, dict):
        out["sizes"] = {str(k): w for k, v in sizes.items()
                        if (w := _num(v, 0.05, 100)) is not None}
    gap = _num(figure.get("gap_mm"), 0, 100)
    if gap is not None:
        out["gap_mm"] = gap
    letters = figure.get("letters")
    if isinstance(letters, dict):
        lt = out["letters"]
        if isinstance(letters.get("show"), bool):
            lt["show"] = letters["show"]
        size = _num(letters.get("size_pt"), 4, 48)
        if size is not None:
            lt["size_pt"] = size
        if letters.get("weight") in ("bold", "normal"):
            lt["weight"] = letters["weight"]
        if letters.get("position") in ("outside", "inside"):
            lt["position"] = letters["position"]
    if isinstance(figure.get("share_x"), bool):
        out["share_x"] = figure["share_x"]
    for k in ("width_mm", "height_mm"):
        v = _num(figure.get(k), 10, 2000)
        out[k] = v
    return out


def tag_of(spec: dict) -> str:
    t = spec.get("tag")
    return t.strip() if isinstance(t, str) else ""


def panel_order(figure: dict | None, analyses: list[dict]) -> list[dict]:
    """The analyses that are panels, in figure order: every analysis with a
    non-empty tag, those listed in ``figure["panels"]`` first (in that order),
    then the rest in document order."""
    tagged = [a for a in analyses if tag_of(a)]
    listed = (figure or {}).get("panels") or []
    rank = {pid: i for i, pid in enumerate(listed)}
    first = sorted((a for a in tagged if a.get("id") in rank),
                   key=lambda a: rank[a["id"]])
    rest = [a for a in tagged if a.get("id") not in rank]
    return first + rest


# --------------------------------------------------------------------- drawing

def _is_colorbar(ax) -> bool:
    return getattr(ax, "_colorbar", None) is not None


def _main_axes(sub):
    return [a for a in sub.axes if not _is_colorbar(a)]


def _share_x(subs: list) -> None:
    """One x range for every panel, and x tick labels / x label only on the
    bottom panel. Before layout, so constrained layout reclaims the space."""
    axes = [a for s in subs for a in _main_axes(s)]
    if not axes:
        return
    lims = [a.get_xlim() for a in axes]
    if all(lo <= hi for lo, hi in lims):
        lo, hi = min(l[0] for l in lims), max(l[1] for l in lims)
        for a in axes:
            a.set_xlim(lo, hi)
    for s in subs[:-1]:
        for a in _main_axes(s):
            a.tick_params(axis="x", which="both", labelbottom=False, labeltop=False)
            a.set_xlabel("")
            a.xaxis.offsetText.set_visible(False)
        sup = getattr(s, "_supxlabel", None)
        if sup is not None:
            sup.set_visible(False)
            sup.set_in_layout(False)


def _align(subs: list, direction: str, share_x: bool, fixed: set | None = None) -> None:
    """Line the panels' plot areas up after layout. Rows: every panel's axes
    block starts at the same left edge (with share_x it also ends at the same
    right edge, so the x axes coincide). Columns: bottoms and tops line up. The block
    of plot areas of each panel is mapped linearly (its colorbar moves with it),
    so a facet grid inside a panel keeps its own arrangement. Axes positions are
    fractions of their subfigure, and panels keep their own canvas size, so the
    comparison is made in figure pixels. A panel in ``fixed`` (its plot-area
    size is pinned, and so already placed where its labels fit, or as near as
    its canvas allows) is never moved: it is the reference the others line up
    to. Without one, the common edge is the largest of the panels' margins."""
    rows = direction == "rows"
    fixed = fixed or set()
    blocks = []
    for s in subs:
        sb = s.bbox
        o, ext = (sb.x0, sb.width) if rows else (sb.y0, sb.height)
        pos = [(a, a.get_position()) for a in s.axes]
        # the plot areas set the block; a colorbar rides along with the mapping
        main = [p for a, p in pos if not _is_colorbar(a)]
        if not main or ext <= 0:
            continue
        if rows:
            lo, hi = min(p.x0 for p in main), max(p.x1 for p in main)
        else:
            lo, hi = min(p.y0 for p in main), max(p.y1 for p in main)
        blocks.append((pos, o + lo * ext, o + hi * ext, o, ext, s in fixed))
    if len(blocks) < 2:
        return
    ref = [b for b in blocks if b[5]] or blocks
    target_lo = max(b[1] for b in ref)
    target_hi = min(b[2] for b in ref)
    for pos, lo, hi, o, ext, is_fixed in blocks:
        if is_fixed:
            continue
        # side by side the plot areas share top and bottom; stacked, the right
        # edge only with a shared x
        new_hi = target_hi if (share_x or not rows) else hi
        span = hi - lo
        if span <= 0 or new_hi <= target_lo:
            continue
        k = (new_hi - target_lo) / span
        for a, p in pos:
            if rows:
                x0 = (target_lo + (o + p.x0 * ext - lo) * k - o) / ext
                a.set_position([x0, p.y0, p.width * k, p.height])
            else:
                y0 = (target_lo + (o + p.y0 * ext - lo) * k - o) / ext
                a.set_position([p.x0, y0, p.width, p.height * k])


def _letter_kw(letters: dict, index: int) -> dict:
    return dict(fontsize=letters["size_pt"], fontweight=letters["weight"],
                color=compiler.INK, ha="left", va="top", gid=f"panel-letter-{index}")


def _letter_inside(sub, tag: str, letters: dict, index: int) -> None:
    axes = _main_axes(sub)
    if not axes:
        return
    off = mtransforms.ScaledTranslation(3 / 72, -3 / 72, sub.dpi_scale_trans)
    t = axes[0].text(0, 1, tag, transform=axes[0].transAxes + off, **_letter_kw(letters, index))
    t.set_in_layout(False)


def _band_mm(lay: dict) -> float:
    """The height of the letter band above the panels: letters placed "outside"
    sit in a strip of their own, so a panel's canvas — and a plot area pinned
    inside it — stays exactly what its analysis says."""
    letters = lay["letters"]
    if not letters["show"] or letters["position"] == "inside":
        return 0.0
    return letters["size_pt"] * 1.3 / 72 * 25.4 + 2.0


def _letter_in_band(fig, sub, tag: str, letters: dict, index: int, band_mm: float,
                    top_px: float | None = None) -> None:
    """The letter at the top-left of the band above the panel, placed in figure
    fractions once the layout is final (so every export dpi agrees). `top_px`
    is the top of the panels' row when panels sit side by side: a shorter panel
    is bottom-aligned, so its own top would put its letter lower than the
    others; every letter of a row stands on the same line instead."""
    b = sub.bbox
    W, H = fig.bbox.width, fig.bbox.height
    top = b.y1 if top_px is None else top_px
    off = mtransforms.ScaledTranslation(1 / 72, -1 / 72, fig.dpi_scale_trans)
    t = fig.text(b.x0 / W, (top + band_mm * compiler.MM * fig.dpi) / H, tag,
                 transform=fig.transFigure + off, **_letter_kw(letters, index))
    t.set_in_layout(False)


def _prefix_gids(sub, index: int) -> None:
    """Panels reuse the builders' gids (plot-area, legend, lbl-x, ...); prefix
    them per panel so the assembled SVG keeps its ids unique."""
    for art in sub.findobj(lambda a: bool(a.get_gid())):
        gid = art.get_gid()
        if not gid.startswith("panel-"):
            art.set_gid(f"p{index}-{gid}")


class _Probe(Exception):
    pass


def _probe_size(p: dict):
    """The panel's canvas (w, h) in mm, as its build asks for it; None if the
    build fails before (the real pass then reports the failure)."""
    got: list = []

    def parent(w_mm, h_mm):
        got.append((float(w_mm), float(h_mm)))
        raise _Probe()

    token = compiler._PANEL_PARENT.set(parent)
    try:
        p["draw"]()
    except _Probe:
        pass
    except Exception:  # noqa: BLE001 — the real pass reports it
        pass
    finally:
        compiler._PANEL_PARENT.reset(token)
    return got[0] if got else None


def build(panels: list[dict], figure: dict | None, *, strict: bool = True):
    """Draw the panels into one figure and return it.

    ``panels`` is the ordered list ``[{"id", "tag", "draw"}]`` where ``draw`` is a
    zero-argument callable that builds the analysis the ordinary way (e.g.
    ``lambda: render.render(table, spec)``); its figure-building happens inside
    the panel's subfigure. With ``strict=False`` a panel that fails is drawn as
    its error message instead of failing the whole figure (the live preview).

    The returned figure carries ``_iris_panels``: ``[{"id", "tag", "box",
    "error"}]`` where ``box`` is ``[x0, y0, x1, y1]`` in figure fractions from
    the TOP left, for hit-testing a panel in the rendered image."""
    lay = normalize(figure) or normalize({})
    n = len(panels)
    if n == 0:
        raise AssemblyError("the figure has no panels: give at least one analysis a tag")
    rows = lay["direction"] == "rows"
    # each panel keeps its own canvas: measure them first (a probe stops each
    # build at the moment it asks for its grid), so a narrower panel of a stack
    # or a shorter one of a row gets a slot of its own size, not a stretched one
    probed = [_probe_size(p) for p in panels]
    default = (float(STYLE_DEFAULTS["width_mm"]), float(STYLE_DEFAULTS["height_mm"]))
    natural = [z or default for z in probed]
    across_fixed = lay["width_mm"] if rows else lay["height_mm"]
    across_max = max(((w if rows else h) for w, h in (z for z in probed if z)), default=0.0)

    # ---- size: the total, the panels' shares of it, the gap and the letter band
    band = _band_mm(lay)
    gap = lay["gap_mm"] if n > 1 else 0.0
    along = [h for _, h in natural] if rows else [w for w, _ in natural]
    across = [w for w, _ in natural] if rows else [h for _, h in natural]
    if lay["sizes"] is None:
        weights = along
    else:
        weights = [lay["sizes"].get(p.get("id"), 1.0) for p in panels]
    bands_along = band * n if rows else 0.0           # stacked: a band per panel
    total_along = lay["height_mm"] if rows else lay["width_mm"]
    if total_along is None:   # custom weights share the summed natural extent
        total_along = sum(along) + gap * (n - 1) + bands_along
    panels_along = max(total_along - gap * (n - 1) - bands_along, 1e-6)
    share = [panels_along * w / sum(weights) for w in weights]
    if across_fixed is None:
        total_across = max(across) + (0.0 if rows else band)
    else:
        total_across = across_fixed
    panels_across = total_across - (0.0 if rows else band)
    width_mm, height_mm = ((total_across, total_along) if rows
                           else (total_along, total_across))

    fig = plt.figure(layout="constrained")
    fig.set_size_inches(width_mm * compiler.MM, height_mm * compiler.MM)
    avg = max(sum(share) / n + (band if rows else 0.0), 1e-6)
    if rows:
        gs = fig.add_gridspec(n, 1, height_ratios=[s + band for s in share],
                              hspace=gap / avg if n > 1 else 0.0)
    else:
        outer = (fig.add_gridspec(2, 1, height_ratios=[band, panels_across], hspace=0)
                 if band > 0 else fig.add_gridspec(1, 1))
        gs = outer[-1, 0].subgridspec(1, n, width_ratios=share,
                                      wspace=gap / avg if n > 1 else 0.0)
    subs, errors = [], []
    for i, p in enumerate(panels):
        slot = gs[i, 0] if rows else gs[0, i]
        if rows and band > 0:   # the panel below its own letter band
            slot = slot.subgridspec(2, 1, height_ratios=[band, share[i]], hspace=0)[1, 0]
        size = probed[i]
        # stacked, a narrower panel keeps its own width, left-aligned. Side by
        # side every panel takes the row's height: a shorter one bottom-aligned
        # under empty space would pull the tops of the others' plot areas down
        # to its own when the tops are lined up (_align), squashing them.
        if size and across_fixed is None and rows:
            a = size[0]
            if across_max - a > 0.5:
                slot = slot.subgridspec(1, 2, width_ratios=[a, across_max - a], wspace=0)[0, 0]
        made: dict = {}

        def parent(w_mm, h_mm, slot=slot, made=made):
            if "sub" in made:
                raise AssemblyError("a panel asked for a second grid")
            made["sub"] = fig.add_subfigure(slot)
            made["size"] = (float(w_mm), float(h_mm))
            return made["sub"]

        token = compiler._PANEL_PARENT.set(parent)
        err = None
        try:
            p["draw"]()
        except Exception as e:  # noqa: BLE001 — reported per panel
            if strict:
                compiler.close(fig)
                label = p.get("tag") or p.get("id") or str(i + 1)
                raise AssemblyError(f"panel {label}: {e}") from e
            err = str(getattr(e, "detail", None) or e) or type(e).__name__
        finally:
            compiler._PANEL_PARENT.reset(token)
        sub = made.get("sub")
        if sub is None:
            sub = fig.add_subfigure(slot)
        if err is not None:
            sub.clear()
            sub.text(0.5, 0.5, f"{p.get('tag') or ''}  {err}".strip(),
                     ha="center", va="center", wrap=True, color="#b91c1c",
                     fontsize=8)
        subs.append(sub)
        errors.append(err)

    if lay["share_x"] and rows and n > 1:
        _share_x([s for s, e in zip(subs, errors) if e is None])
    if lay["letters"]["show"] and band == 0:
        for i, (s, p) in enumerate(zip(subs, panels)):
            if p.get("tag") and errors[i] is None:
                _letter_inside(s, p["tag"], lay["letters"], i)

    # ---- layout, then align and freeze, then the deferred per-panel passes
    sizes = [s.__dict__.pop("_iris_plot_size", None) for s in subs]
    fig.canvas.draw()
    # a pinned plot-area size (style plot_w_mm/plot_h_mm) is honoured: the box
    # gets that size inside its panel and sits where its labels fit, exactly as
    # it does alone (compiler._place_plot); the alignment below then keeps that
    # size and only shifts the box
    for stash in sizes:
        if stash:
            compiler._place_plot(*stash)
    fig.set_layout_engine("none")
    fig.canvas.draw()
    fixed = {s for s, stash in zip(subs, sizes) if stash}
    _align([s for s, e in zip(subs, errors) if e is None], lay["direction"],
           lay["share_x"], fixed)
    fig.canvas.draw()
    if band > 0:
        row_top = None if rows else max(s.bbox.y1 for s in subs)
        for i, (s, p) in enumerate(zip(subs, panels)):
            if p.get("tag"):
                _letter_in_band(fig, s, p["tag"], lay["letters"], i, band, row_top)
    for owner in [fig, *subs]:
        compiler._apply_beeswarm(owner)
        compiler._apply_connectors(owner)
        compiler._apply_legend_offset(owner)
    fig.__dict__.pop("_iris_plot_size", None)
    for i, s in enumerate(subs):
        _prefix_gids(s, i)

    W, H = fig.bbox.width, fig.bbox.height
    info = []
    for s, p, e in zip(subs, panels, errors):
        b = s.bbox
        info.append({"id": p.get("id"), "tag": p.get("tag") or "",
                     "box": [float(b.x0 / W), float(1 - b.y1 / H),
                             float(b.x1 / W), float(1 - b.y0 / H)],
                     "error": e})
    fig._iris_panels = info
    fig._iris_size_mm = (float(width_mm), float(height_mm))
    return fig


# ----------------------------------------------------------- library entry point

def _bind_tables(spec: dict, tables: dict) -> tuple[dict, dict]:
    """(main table, spec with every reduce source carrying its rows inline):
    the shape render.render takes. ``tables`` is ``{name: {schema, rows, ...}}``
    as document.save_document takes it and load_document returns it."""
    if not tables:
        raise AssemblyError("the document has no tables")
    first = next(iter(tables))

    def wire(name):
        t = tables.get(name)
        if t is None:
            raise AssemblyError(f"analysis {spec.get('id')!r} references unknown table {name!r}")
        return {"schema": t["schema"], "rows": t["rows"]}

    main_name = spec.get("table_id") or first
    main = wire(main_name)
    reduce_block = spec.get("reduce") or {}
    if "nodes" in reduce_block:
        nodes = [{**n, "table": wire(n.get("table_id") or main_name)}
                 if n.get("kind") == "source" and "table" not in n else n
                 for n in reduce_block["nodes"]]
        spec = {**spec, "reduce": {**reduce_block, "nodes": nodes}}
    return main, spec


def render_figure(tables: dict, analyses: list[dict], figure: dict | None):
    """Render a document's figure assembly to one matplotlib figure, without
    FastAPI. ``tables`` and ``analyses`` are what ``document.save_document``
    takes (or ``load_document`` returns); the panels are the tagged analyses
    in ``figure`` order. Write it with ``compiler.figure_to_svg(fig)`` or
    ``compiler.figure_to_bytes(fig, "png", dpi=...)``, then
    ``compiler.close(fig)``. Raises AssemblyError if a panel cannot be drawn."""
    from . import render as render_mod
    order = panel_order(figure, analyses)
    panels = []
    for spec in order:
        table, bound = _bind_tables(spec, tables)
        panels.append({"id": spec.get("id"), "tag": tag_of(spec),
                       "draw": lambda t=table, s=bound: render_mod.render(t, s)[0]})
    return build(panels, figure, strict=True)


def render_iris(data: bytes):
    """The figure a saved ``.iris`` shows: its assembly when it has one, else
    its single analysis. Returns a matplotlib figure (see render_figure)."""
    from . import document, render as render_mod
    doc = document.load_document(data)
    if doc.get("figure") is not None:
        return render_figure(doc["tables"], doc["analyses"], doc["figure"])
    if len(doc["analyses"]) != 1:
        raise AssemblyError(
            f"the document holds {len(doc['analyses'])} analyses and no figure assembly")
    table, spec = _bind_tables(doc["analyses"][0], doc["tables"])
    return render_mod.render(table, spec)[0]
