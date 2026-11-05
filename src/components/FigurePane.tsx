import { useAtomValue, useAtom, useSetAtom } from "jotai";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  activePlottableAtom, analysisAtom, analyzeStatusAtom, autoPlotAreaAtom, dataLoadingAtom,
  figureViewMemoryAtom, pushDragSnapshotAtom, redoDragAtom, renderErrorAtom, undoDragAtom,
} from "../state";
import type { StyleOverrides } from "../types";
import { plotSizeMm, resizeCanvas, setPlotSize } from "../plotArea";
import { fmtRect, logEditAtom, pointerTag } from "../editLog";

const SVGNS = "http://www.w3.org/2000/svg";

/* gid-tagged artists the engine marks as draggable (title, axis labels, the
   r/p or median annotation, and the legend) */
const DRAGGABLE = ["lbl-title", "lbl-x", "lbl-y", "lbl-annot", "legend"];

const PT_PER_MM = 72 / 25.4;
const PX_PER_PT = 96 / 72;
/* The figure sits on a viewport (the host, a fixed-height grey ground) like a
   sheet on an Inkscape canvas: the SVG keeps its true size at 96 dpi and the
   view transform (pan + zoom) moves the sheet under the viewport. */
function baseSize(svg: SVGSVGElement, vb: DOMRect | SVGRect) {
  svg.style.width = `${vb.width * PX_PER_PT}px`;
  svg.style.height = `${vb.height * PX_PER_PT}px`;
  svg.style.maxWidth = "none";
}
/* the view that fits the whole sheet in the viewport, centred, with a margin */
const FIT_MARGIN = 14;
function fitFor(vw: number, vh: number, fw: number, fh: number) {
  if (!fw || !fh || vw <= 0 || vh <= 0) return { z: 1, x: 0, y: 0 };
  const z = Math.min((vw - 2 * FIT_MARGIN) / fw, (vh - 2 * FIT_MARGIN) / fh);
  return { z, x: (vw - fw * z) / 2, y: (vh - fh * z) / 2 };
}

/** Renders the engine's SVG and attaches interactivity. Item I: dots are not
 *  individually clickable — they draw as plain vector marks, so there is no
 *  per-point click/select wiring here. Labels drag (each gets a transparent
 *  hit-rect — the glyph strokes alone are unhittable); the canvas corner handle
 *  drag-resizes in real mm; the plot-area grips move/resize the axes within the
 *  canvas. */
export function FigurePane() {
  const analysis = useAtomValue(analysisAtom);
  const status = useAtomValue(analyzeStatusAtom);
  const renderError = useAtomValue(renderErrorAtom);
  const dataLoading = useAtomValue(dataLoadingAtom);
  const [active, setActive] = useAtom(activePlottableAtom);
  /* style updater: merges a patch into the active plottable's style.
     We capture active via a ref so the drag closure always sees the latest value. */
  const activeRef = useRef(active);
  activeRef.current = active;
  /* every setStyle here is a drag release (label, canvas corner, plot-area
     grip), so each one is a drag-undo point (state.ts, "drag history"). */
  const pushDragSnapshot = useSetAtom(pushDragSnapshotAtom);
  const [canUndoDrag, undoDrag] = useAtom(undoDragAtom);
  const [canRedoDrag, redoDrag] = useAtom(redoDragAtom);
  /* every manual edit, and every drag that was ignored, goes to the edit log
     (⋯ → Show edit log): the only trace of a drag on the iPad */
  const logEdit = useSetAtom(logEditAtom);
  const setStyle = (updater: StyleOverrides | ((st: StyleOverrides) => StyleOverrides)) => {
    const cur = activeRef.current;
    if (!cur) return;
    const next = typeof updater === "function" ? updater(cur.style) : updater;
    pushDragSnapshot();
    setActive({ ...cur, style: next });
  };
  const sizeMm = (st: StyleOverrides) => {
    const s = plotSizeMm(st);
    return s ? `${s.width ?? "auto"}×${s.height ?? "auto"} mm` : "auto";
  };
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  /* plot-area (axes) rect in figure-host px, for the resize grip. Null when
     the engine didn't tag a plot area (e.g. faceted figures). */
  const [plotRect, setPlotRect] =
    useState<{ left: number; top: number; width: number; height: number } | null>(null);

  /* View-only zoom and pan (item H): a pure presentation transform of the
     already-rendered SVG — never sent to the engine, never saved or exported.
     `z` = scale on the sheet's true size, `x`/`y` = where the sheet's top-left
     sits in viewport px. The view starts fitted and refits with the viewport
     until the user zooms or pans (`touched`); Fit returns to it. The zoom
     readout is relative to the fit (100 % = the whole sheet in view). */
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const fitRef = useRef({ z: 1, x: 0, y: 0 });
  const touched = useRef(false);
  const baseRef = useRef({ w: 0, h: 0 });
  /* a touched view is remembered per plot (figureViewMemoryAtom) and restored
     on coming back to it; `viewOwner` is the plot the current view belongs to */
  const [viewMemory, setViewMemory] = useAtom(figureViewMemoryAtom);
  const viewMemoryRef = useRef(viewMemory); viewMemoryRef.current = viewMemory;
  const viewOwner = useRef<string | null>(null);
  const activeId = active?.id ?? null;
  const currentFit = () => {
    const el = host.current;
    return el ? fitFor(el.clientWidth, el.clientHeight, baseRef.current.w, baseRef.current.h) : { z: 1, x: 0, y: 0 };
  };
  const refit = () => { fitRef.current = currentFit(); setView(fitRef.current); };
  /* Edit | Pan: in Edit a drag moves a label or pulls a corner, at any
     zoom (zoom in for precision); in Pan a drag pans the view and a wheel
     zooms it, and the grips are hidden so nothing can be edited by accident.
     A two-finger pinch zooms, and a drag on blank canvas pans, in both modes. */
  const [pan, setPan] = useState(false);
  const viewRef = useRef(view); viewRef.current = view;
  const panRef = useRef(pan); panRef.current = pan;
  const HOST_PAD = 0; /* .figure-host padding, so cursor maths is in viewport px */
  const ZOOM_MIN = 0.2, ZOOM_MAX = 16; /* relative to the fit */
  const clampZ = (z: number) =>
    Math.max(fitRef.current.z * ZOOM_MIN, Math.min(fitRef.current.z * ZOOM_MAX, z));
  /* the sheet may be panned anywhere as long as a corner of it stays in view */
  const clampView = (v: { z: number; x: number; y: number }) => {
    const el = host.current;
    if (!el) return v;
    const keep = 48, w = el.clientWidth, h = el.clientHeight;
    const fw = baseRef.current.w * v.z, fh = baseRef.current.h * v.z;
    return { z: v.z, x: Math.min(w - keep, Math.max(keep - fw, v.x)), y: Math.min(h - keep, Math.max(keep - fh, v.y)) };
  };

  /* the grips are absolutely positioned in .figure-frame (the host's parent),
     which on touch also holds the toolbar row above the host — so they are
     placed against the FRAME's rect, not the host's */
  const frameRect = () => (host.current?.parentElement ?? host.current)!.getBoundingClientRect();

  /* keep the resize handle glued to the SVG's bottom-right corner */
  const placeHandle = () => {
    const el = host.current, h = handle.current;
    const svg = el?.querySelector("svg");
    if (!el || !h || !svg) return;
    const er = frameRect();
    const sr = svg.getBoundingClientRect();
    h.style.left = `${sr.right - er.left - 7}px`;
    h.style.top = `${sr.bottom - er.top - 7}px`;
  };

  /* the engine tags the axes background <g id="plot-area"> (unfaceted only); a
     resize grip sits at its bottom-right corner. Its mm rect is published for
     the Layout tab, so the automatic layout reads as numbers too. */
  const setAutoPlotArea = useSetAtom(autoPlotAreaAtom);
  const placePlotHandles = () => {
    const el = host.current;
    const svg = el?.querySelector("svg");
    const pa = el?.querySelector("#plot-area") as SVGGraphicsElement | null;
    if (!el || !svg || !pa) { setPlotRect(null); setAutoPlotArea(null); return; }
    const er = frameRect();
    const pr = pa.getBoundingClientRect();
    setPlotRect({ left: pr.left - er.left, top: pr.top - er.top,
                  width: pr.width, height: pr.height });
    const sr = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    if (sr.width > 0 && sr.height > 0 && vb.width > 0) {
      const mmX = vb.width / PT_PER_MM / sr.width, mmY = vb.height / PT_PER_MM / sr.height;
      const r1 = (v: number) => Math.round(v * 10) / 10;
      setAutoPlotArea({ left: r1((pr.left - sr.left) * mmX), top: r1((pr.top - sr.top) * mmY),
                        width: r1(pr.width * mmX), height: r1(pr.height * mmY) });
    }
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    /* no analysis (invalidated / errored / not yet mapped): clear the stale SVG
       so the placeholder shows alone — the error/empty overlay is a static
       block, not a cover, so a leftover figure would render beside it (item 11) */
    if (!analysis) {
      el.innerHTML = "";
      setDims(null);
      setPlotRect(null);
      return;
    }
    /* Trust boundary: the SVG is injected as raw markup. It is safe because it
       comes only from our own localhost engine's matplotlib renderer — never a
       remote/user-supplied source — and matplotlib escapes data text into SVG.
       Keep this invariant: don't point the figure host at untrusted markup. */
    el.innerHTML = analysis.figure.svg;
    const svg = el.querySelector("svg");
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    baseSize(svg, vb);
    baseRef.current = { w: vb.width * PX_PER_PT, h: vb.height * PX_PER_PT };
    /* the sheet keeps the user's view across re-renders; untouched, it fits.
       A different plot brings its own remembered view, or starts fitted. */
    fitRef.current = currentFit();
    if (viewOwner.current !== activeId) {
      viewOwner.current = activeId;
      const remembered = activeId ? viewMemoryRef.current[activeId] : undefined;
      touched.current = !!remembered;
      if (remembered) { viewRef.current = remembered; setView(remembered); }
    }
    if (!touched.current) setView(fitRef.current);
    const v = touched.current ? viewRef.current : fitRef.current;
    svg.style.transformOrigin = "0 0";
    svg.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    setDims({ w: Math.round(vb.width / PT_PER_MM), h: Math.round(vb.height / PT_PER_MM) });
    placeHandle();
    placePlotHandles();
    const ro = new ResizeObserver(() => {
      /* the viewport changed size (card resized, maximized): refit an untouched view */
      fitRef.current = currentFit();
      if (!touched.current) setView(fitRef.current);
      placeHandle(); placePlotHandles();
    });
    ro.observe(el);

    /* labels: drag to move; viewBox units == engine pt, so the committed
       offset is resolution-independent */
    const scale = () => (vb.width ? vb.width / svg.getBoundingClientRect().width : 1);
    for (const gid of DRAGGABLE) {
      const g = el.querySelector(`g#${CSS.escape(gid)}`) as SVGGElement | null;
      if (!g) continue;
      /* glyph strokes are sub-pixel targets; a transparent rect over the
         bbox makes the whole label grabbable */
      const bb = g.getBBox();
      const hit = document.createElementNS(SVGNS, "rect");
      hit.setAttribute("x", String(bb.x - 4));
      hit.setAttribute("y", String(bb.y - 4));
      hit.setAttribute("width", String(bb.width + 8));
      hit.setAttribute("height", String(bb.height + 8));
      hit.setAttribute("fill", "none");
      hit.setAttribute("pointer-events", "all");
      g.insertBefore(hit, g.firstChild);
      g.style.cursor = "move";
      g.setAttribute("data-drag", "");
      const tip = document.createElementNS(SVGNS, "title");
      tip.textContent = "Drag to reposition";
      g.insertBefore(tip, g.firstChild);
      g.addEventListener("pointerdown", (e0) => {
        /* in Pan mode the drag bubbles to the pane's pan handler instead */
        if (panRef.current) return;
        e0.preventDefault();
        e0.stopPropagation();
        const s = scale();
        let dx = 0, dy = 0;
        const move = (e: PointerEvent) => {
          if (pinching.current) return;
          dx = (e.clientX - e0.clientX) * s;
          dy = (e.clientY - e0.clientY) * s;
          g.setAttribute("transform", `translate(${dx} ${dy})`);
        };
        const up = (e: Event) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          const tag = pointerTag(e0, e);
          if (pinching.current) {
            g.removeAttribute("transform");
            logEdit({ what: "label ignored", detail: `${gid}: became a pinch (${tag})` });
            return;
          }
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            logEdit({ what: "label ignored", detail: `${gid}: no movement (${tag})` });
            return;
          }
          setStyle((st) => {
            const prev = st.offsets?.[gid] ?? [0, 0];
            const next: [number, number] = [prev[0] + dx, prev[1] + dy];
            logEdit({ what: "label", detail: `${gid}: offset ${fmtRect(prev, 1)} → ${fmtRect(next, 1)} pt (${tag})` });
            return { ...st, offsets: { ...st.offsets, [gid]: next } };
          });
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
      });
    }
    return () => { ro.disconnect(); };
  }, [analysis]);

  /* apply the view-only zoom transform to the rendered SVG (top-left origin so
     the pan/zoom-to-cursor maths is in plain host px). Runs after the injection
     effect re-creates the SVG, and on every pan/zoom change. The grips track the
     transform via getBoundingClientRect, so reposition them too. */
  useEffect(() => {
    const svg = host.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;
    svg.style.transformOrigin = "0 0";
    svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    placeHandle();
    placePlotHandles();
    /* remember a touched view for this plot; Fit forgets it */
    const id = viewOwner.current;
    if (id) setViewMemory((m) => {
      if (touched.current) return m[id] === view ? m : { ...m, [id]: view };
      if (!(id in m)) return m;
      const { [id]: _drop, ...rest } = m; return rest;
    });
  }, [view, analysis]);

  /* pinch zoom (touch): two fingers on the figure scale the view about their
     midpoint and pan with it, in either mode. The host sees every press first
     (capture phase); the second finger of a pinch is stopped there, so it never
     starts a drag of its own, and `pinching` makes the drag the first finger
     may have begun (a label, a grip, a pan) a no-op that commits nothing. */
  const pinching = useRef(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const fingers = new Map<number, { x: number; y: number }>();
    let start: { z: number; x: number; y: number; d: number; mx: number; my: number } | null = null;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left - HOST_PAD, y: e.clientY - r.top - HOST_PAD };
    };
    const geometry = () => {
      const [a, b] = [...fingers.values()];
      return { d: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      fingers.set(e.pointerId, local(e));
      if (fingers.size === 2) {
        pinching.current = true;
        touched.current = true;
        const v = viewRef.current;
        start = { z: v.z, x: v.x, y: v.y, ...geometry() };
        e.stopPropagation();
        e.preventDefault();
        logEdit({ what: "pinch", detail: `start at ${Math.round(v.z / (fitRef.current.z || 1) * 100)} %` });
      }
    };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, local(e));
      if (!start || fingers.size < 2) return;
      const { d, mx, my } = geometry();
      const z = clampZ(start.z * d / Math.max(1, start.d));
      const k = z / start.z;
      /* the sheet point under the fingers' first midpoint stays under their midpoint now */
      setView(clampView({ z, x: mx - (start.mx - start.x) * k, y: my - (start.my - start.y) * k }));
    };
    const up = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      if (fingers.size < 2) start = null;
      if (fingers.size === 0 && pinching.current) {
        pinching.current = false;
        logEdit({ what: "pinch", detail: `end at ${Math.round(viewRef.current.z / (fitRef.current.z || 1) * 100)} %` });
      }
    };
    el.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);

  /* wheel zoom (toward the cursor). Non-passive so we can preventDefault the
     browser/page zoom-scroll. Plain wheel zooms in Pan mode; Ctrl/⌘-wheel — which
     is also how Safari reports a pinch — zooms in either mode. A plain wheel in
     Edit mode is left to the page, so the inspector still scrolls. */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!panRef.current && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      touched.current = true;
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left - HOST_PAD, cy = e.clientY - r.top - HOST_PAD;
      setView((v) => {
        const z = clampZ(v.z * Math.exp(-e.deltaY * 0.0015));
        const k = z / v.z;
        return clampView({ z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* zoom from the toolbar buttons: anchored on the host centre */
  const zoomBy = (factor: number) => {
    const el = host.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2 - HOST_PAD, cy = r.height / 2 - HOST_PAD;
    touched.current = true;
    setView((v) => {
      const z = clampZ(v.z * factor);
      const k = z / v.z;
      return clampView({ z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    });
  };
  const resetView = () => { touched.current = false; refit(); };
  const zoomPct = Math.round(view.z / (fitRef.current.z || 1) * 100);
  const atFit = Math.abs(view.z - fitRef.current.z) < 1e-6
    && Math.abs(view.x - fitRef.current.x) < 0.5 && Math.abs(view.y - fitRef.current.y) < 0.5;

  /* drag to pan: a drag on the ground or on blank sheet, or anywhere in Pan
     mode (the edit handlers bail then and the press bubbles here). */
  const onPanStart = (e0: ReactPointerEvent) => {
    e0.preventDefault();
    touched.current = true;
    const v0 = viewRef.current, sx = e0.clientX, sy = e0.clientY;
    const move = (e: PointerEvent) => {
      if (pinching.current) return;
      setView((v) => clampView({ ...v, x: v0.x + (e.clientX - sx), y: v0.y + (e.clientY - sy) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /* corner handle: drag → live preview in px, commit in mm on release */
  const onResizeStart = (e0: ReactPointerEvent) => {
    const svg = host.current?.querySelector("svg");
    if (!svg || !dims) return;
    e0.preventDefault();
    const vb = svg.viewBox.baseVal;
    /* The figure is only re-rendered (re-laid-out at the new w×h mm) on release.
       For the live preview to show the right *shape*, stretch the existing SVG
       to fill the target box: the default preserveAspectRatio="meet" would
       letterbox and keep the aspect ratio constant — which is exactly the
       reported mismatch with the final render. The maxWidth cap is lifted too
       so the previewed box is the true target size, not the pane width. */
    /* A pinned plot size is kept in mm (plotArea.resizeCanvas), so the preview
       then grows the canvas around the unchanged drawing, anchored at the
       top-left, instead of stretching it. */
    const pinned = Boolean(activeRef.current && plotSizeMm(activeRef.current.style));
    const vb0 = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    /* the figure is displayed at a fit scale (fitSvg), not at 96 dpi: pointer
       deltas and the previewed box both use that scale, so the preview grows
       from the box on screen rather than jumping to true size */
    const pxPerMm = svg.getBoundingClientRect().width / Math.max(1, dims.w);
    svg.setAttribute("preserveAspectRatio", pinned ? "xMinYMin meet" : "none");
    svg.style.maxWidth = "none";
    /* back to the sheet's true size, as the SVG-injection effect sets it up */
    const restoreFit = () => {
      svg.removeAttribute("preserveAspectRatio");
      if (pinned) svg.setAttribute("viewBox", `${vb0.x} ${vb0.y} ${vb0.w} ${vb0.h}`);
      baseSize(svg, svg.viewBox.baseVal);
      placeHandle();
    };
    const dimsFor = (e: PointerEvent) => ({
      w: Math.max(40, Math.round(dims.w + (e.clientX - e0.clientX) / pxPerMm)),
      h: Math.max(30, Math.round(dims.h + (e.clientY - e0.clientY) / pxPerMm)),
    });
    let last: PointerEvent | null = null;
    const move = (e: PointerEvent) => {
      if (pinching.current) return;
      last = e;
      const { w, h } = dimsFor(e);
      if (pinned) svg.setAttribute("viewBox",
        `${vb0.x} ${vb0.y} ${vb0.w * w / dims.w} ${vb0.h * h / dims.h}`);
      svg.style.width = `${w * pxPerMm / viewRef.current.z}px`;
      svg.style.height = `${h * pxPerMm / viewRef.current.z}px`;
      setResizing(`${w} × ${h} mm`);
      placeHandle();
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setResizing(null);
      /* a cancelled pointer (iOS took the touch) ends where it last moved */
      const end = e.type === "pointercancel" ? last : e;
      const tag = pointerTag(e0, e);
      if (pinching.current) { restoreFit(); logEdit({ what: "canvas ignored", detail: `became a pinch (${tag})` }); return; }
      if (!end) { restoreFit(); logEdit({ what: "canvas ignored", detail: `cancelled before any move (${tag})` }); return; }
      const { w, h } = dimsFor(end);
      /* drop the stretched preview either way; a real change re-renders, an
         unchanged release just returns to the fit display */
      restoreFit();
      if (w !== dims.w || h !== dims.h)
        setStyle((st) => {
          const next = resizeCanvas(st, w, h);
          logEdit({ what: "canvas", detail: `${dims.w}×${dims.h} → ${w}×${h} mm, plot ${sizeMm(st)} → ${sizeMm(next)} (${tag}, ${pxPerMm.toFixed(2)} px/mm)` });
          return next;
        });
      else logEdit({ what: "canvas ignored", detail: `unchanged ${w}×${h} mm (${tag})` });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /* plot-area resize: drag the corner grip to resize the axes box, committed
     as its size in mm (plot_w_mm/plot_h_mm). Where the box sits is not ours to
     set: the engine places it where its labels fit, and the canvas (sized by
     the corner handle above) supplies the room to the right and above. The grip
     moves live; the figure re-renders at the committed size on release. */
  const onPlotResize = (e0: ReactPointerEvent) => {
    const el = host.current;
    const svg = el?.querySelector("svg");
    const pa = el?.querySelector("#plot-area") as SVGGraphicsElement | null;
    if (!el || !svg || !pa || !plotRect) {
      logEdit({ what: "plot ignored", detail: `resize: ${!pa ? "no #plot-area in the figure" : "no plot rect yet"}` });
      return;
    }
    e0.preventDefault();
    e0.stopPropagation();
    const sr = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    /* screen px → mm on the sheet, at the current zoom */
    const mmX = vb.width / PT_PER_MM / sr.width, mmY = vb.height / PT_PER_MM / sr.height;
    const r0 = pa.getBoundingClientRect();
    const start = plotRect;
    let last: { clientX: number; clientY: number } = e0;
    const move = (e: PointerEvent) => {
      if (pinching.current) return;
      last = e;
      const dx = e.clientX - e0.clientX, dy = e.clientY - e0.clientY;
      setPlotRect({ ...start, width: Math.max(24, start.width + dx),
                    height: Math.max(24, start.height + dy) });
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      /* a cancelled pointer (iOS took the touch) ends where it last moved */
      const end = e.type === "pointercancel" ? last : e;
      const dx = end.clientX - e0.clientX, dy = end.clientY - e0.clientY;
      const tag = pointerTag(e0, e);
      if (pinching.current || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) {
        placePlotHandles();
        logEdit({ what: "plot ignored", detail: `resize: ${pinching.current ? "became a pinch" : "no movement"} (${tag})` });
        return;
      }
      const width = (r0.width + dx) * mmX, height = (r0.height + dy) * mmY;
      setStyle((st) => {
        const next = setPlotSize(st, { width, height });
        logEdit({ what: "plot resize", detail: `${sizeMm(st)} → ${sizeMm(next)}; Δ ${Math.round(dx)},${Math.round(dy)} px (${tag})` });
        return next;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /* The zoom toolbar floats over the figure's top-right corner and shows only
     while the pointer is over the figure or focus is inside it (always, under a
     coarse pointer, which has no hover; see index.css). */
  return (
    <section className="pane figure-pane">
      <h2 className="figure-title">Figure</h2>
      <div className="figure-frame">
        {analysis && (
          <div className="figure-head-right">
            <div className="figure-tools" role="toolbar" aria-label="Manual edits">
              <button type="button" onClick={() => { logEdit({ what: "undo", detail: "manual edit" }); undoDrag(); }} disabled={!canUndoDrag}
                title="Undo the last move or resize on the figure">↶</button>
              <button type="button" onClick={() => { logEdit({ what: "redo", detail: "manual edit" }); redoDrag(); }} disabled={!canRedoDrag}
                title="Redo the move or resize">↷</button>
            </div>
            <div className="figure-tools" role="toolbar" aria-label="Zoom">
              <button type="button" className={`wide${pan ? "" : " on"}`}
                aria-pressed={!pan} onClick={() => setPan(false)}
                title="Edit: drag labels, the plot area and the corners (at any zoom)">Edit</button>
              <button type="button" className={`wide${pan ? " on" : ""}`}
                aria-pressed={pan} onClick={() => setPan(true)}
                title="Pan: drag to pan, pinch or scroll to zoom. View only; the figure and exports are unchanged.">Pan</button>
              <button type="button" onClick={() => zoomBy(1 / 1.25)}
                disabled={zoomPct <= ZOOM_MIN * 100 + 1} title="Zoom out">−</button>
              <span className="zoom-pct" title="Zoom, relative to the fitted view (view only)">{zoomPct}%</span>
              <button type="button" onClick={() => zoomBy(1.25)}
                disabled={zoomPct >= ZOOM_MAX * 100 - 1} title="Zoom in">+</button>
              <button type="button" onClick={resetView} disabled={atFit}
                title="Fit the whole figure in view">⤢</button>
            </div>
            <span className="provenance" title="Figure size; exports use this size">
              {resizing ?? (dims && `${dims.w} × ${dims.h} mm`)}
            </span>
          </div>
        )}
        <div ref={host}
          className={`figure-host${pan ? " pan-mode" : ""}`}
          onPointerDown={onPanStart} />
        {analysis && !pan && (
          <div ref={handle} className="resize-handle"
            title="Drag to resize the figure (mm); exports match"
            onPointerDown={onResizeStart} />
        )}
        {analysis && plotRect && !pan && (
          <div className="plot-resize" title="Drag to resize the plot area (mm); the engine places it where its labels fit"
            style={{ left: plotRect.left + plotRect.width - 7,
                     top: plotRect.top + plotRect.height - 7 }}
            onPointerDown={onPlotResize} />
        )}
        {(status === "running" || dataLoading) && (
          <div className={`figure-overlay${analysis ? " over-figure" : ""}`}>
            <span className="spinner" />
            <span>{dataLoading ? "Loading data…" : "Rendering…"}</span>
          </div>
        )}
        {!analysis && status !== "running" && !dataLoading && (
          <div className="figure-overlay placeholder">
            {status === "error"
              ? (renderError ?? "Render failed.")
              : "Map Y (and X) in the Encoding card and add a layer to draw a figure."}
          </div>
        )}
      </div>
    </section>
  );
}
