"""Parse a rendered figure SVG into *structural* facts the validation cases
assert against — mark counts, geom layers, axis/label text, tick labels.

Deliberately structural, never pixel-exact: it reads the gids the engine stamps
on the figure (``lbl-x``/``lbl-y``/``lbl-title``/``lbl-annot`` draggable labels,
``legend``) plus matplotlib's own ``PathCollection_N`` scatter groups, and the
text matplotlib emits as SVG comments. That survives font-hinting and
matplotlib-version differences across machines (and the coming macOS/Windows
packaging), where an image diff would not.

Point marks are counted from matplotlib's ``<g id="PathCollection_N">`` scatter
groups (one ``<use>`` per drawn point). Item I removed the engine's per-point
``pts-N`` gid/click contract, so the marks are plain vector glyphs now; the
matplotlib-assigned collection group is the stable structural handle.

Regex-only, no XML dependency: matplotlib's SVG is regular enough, and the label
gids we rely on are written by the engine itself (see ``compiler._tag_labels``),
so they are a stable contract rather than an implementation detail.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field


@dataclass
class SvgFacts:
    """Structural facts extracted from one figure SVG."""
    has_svg: bool = False
    axis_labels: dict = field(default_factory=dict)   # {"x": str, "y": str}
    title: str | None = None
    annotation: str | None = None
    point_groups: list = field(default_factory=list)  # [(gid, n_use), ...] scatter colls
    xtick_labels: list = field(default_factory=list)
    ytick_labels: list = field(default_factory=list)
    legend_labels: list = field(default_factory=list)
    n_patches: int = 0                                 # <g id="patch_N"> count

    @property
    def n_points(self) -> int:
        return sum(n for _, n in self.point_groups)


def _group_inner(svg: str, gid: str) -> str | None:
    """Return the inner SVG of ``<g id="gid"> … </g>``, honoring nesting.

    matplotlib groups (labels, legend, ticks) can contain nested ``<g>``s, so a
    non-greedy ``.*?`` would stop at the first ``</g>``. Walk the tag stream and
    match the close at the same depth."""
    start = re.search(rf'<g id="{re.escape(gid)}"[^>]*>', svg)
    if not start:
        return None
    i = start.end()
    depth = 1
    for m in re.finditer(r"<g\b[^>]*>|</g>", svg[i:]):
        if m.group().startswith("</g"):
            depth -= 1
            if depth == 0:
                return svg[i:i + m.start()]
        else:
            depth += 1
    return svg[i:]  # unterminated (shouldn't happen for valid SVG)


def _first_comment(fragment: str) -> str | None:
    m = re.search(r"<!--\s*(.*?)\s*-->", fragment, re.S)
    return html.unescape(m.group(1)) if m else None


def _label_text(svg: str, gid: str) -> str | None:
    inner = _group_inner(svg, gid)
    return _first_comment(inner) if inner is not None else None


def _tick_labels(svg: str, axis: str) -> list[str]:
    """Ordered tick-label text for an axis. matplotlib emits each label's string
    as a comment inside a nested text group within ``<g id="xtick_N">`` /
    ``ytick_N``; ticks with no text label (numeric gridlines) contribute
    nothing. Uses the depth-aware extractor — the tick group nests the tickline
    and label groups, so a non-greedy scan would stop short of the comment."""
    out = []
    for m in re.finditer(rf'<g id="({axis}tick_\d+)"', svg):
        txt = _first_comment(_group_inner(svg, m.group(1)) or "")
        if txt:
            out.append(txt)
    return out


def parse(svg: str) -> SvgFacts:
    f = SvgFacts(has_svg="<svg" in svg)

    for axis, gid in (("x", "lbl-x"), ("y", "lbl-y")):
        t = _label_text(svg, gid)
        if t is not None:
            f.axis_labels[axis] = t
    f.title = _label_text(svg, "lbl-title")
    f.annotation = _label_text(svg, "lbl-annot")

    # point marks: matplotlib wraps each scatter call in <g id="PathCollection_N">
    # holding one <use> per drawn point. Sorted by N so order is render order.
    pts = []
    for m in re.finditer(r'<g id="(PathCollection_\d+)"[^>]*>', svg):
        gid = m.group(1)
        inner = _group_inner(svg, gid) or ""
        pts.append((gid, len(re.findall(r"<use\b", inner))))
    f.point_groups = sorted(pts, key=lambda g: int(g[0].split("_")[1]))

    f.xtick_labels = _tick_labels(svg, "x")
    f.ytick_labels = _tick_labels(svg, "y")

    legend = _group_inner(svg, "legend")
    if legend is not None:
        f.legend_labels = [html.unescape(t)
                           for t in re.findall(r"<!--\s*(.*?)\s*-->", legend, re.S)]

    f.n_patches = len(re.findall(r'<g id="patch_\d+">', svg))
    return f
