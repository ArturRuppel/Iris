import { useAtomValue, useAtom } from "jotai";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  activePlottableAtom, analysisAtom, analyzeStatusAtom, dataLoadingAtom,
  renderErrorAtom, tableHandleAtom,
} from "../state";
import type { StyleOverrides } from "../types";
import { StylePane } from "./StylePane";

const SVGNS = "http://www.w3.org/2000/svg";

/* gid-tagged artists the engine marks as draggable (title, axis labels, the
   r/p or median annotation, and the legend) */
const DRAGGABLE = ["lbl-title", "lbl-x", "lbl-y", "lbl-annot", "legend"];

const PT_PER_MM = 72 / 25.4;
const PX_PER_PT = 96 / 72;

/** Renders the engine's SVG and attaches interactivity. Item I: dots are not
 *  individually clickable — they draw as plain vector marks and exclusion lives
 *  in the DataTable, so there is no per-point click/select wiring here. Labels
 *  drag (each gets a transparent hit-rect — the glyph strokes alone are
 *  unhittable); the canvas corner handle drag-resizes in real mm; the plot-area
 *  grips move/resize the axes within the canvas. */
export function FigurePane() {
  const analysis = useAtomValue(analysisAtom);
  const status = useAtomValue(analyzeStatusAtom);
  const renderError = useAtomValue(renderErrorAtom);
  const dataLoading = useAtomValue(dataLoadingAtom);
  const tableHandle = useAtomValue(tableHandleAtom);
  const [active, setActive] = useAtom(activePlottableAtom);
  /* style updater: merges a patch into the active plottable's style.
     We capture active via a ref so the drag closure always sees the latest value. */
  const activeRef = useRef(active);
  activeRef.current = active;
  const setStyle = (updater: StyleOverrides | ((st: StyleOverrides) => StyleOverrides)) => {
    const cur = activeRef.current;
    if (!cur) return;
    const next = typeof updater === "function" ? updater(cur.style) : updater;
    setActive({ ...cur, style: next });
  };
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  /* plot-area (axes) rect in figure-host px, for the move/resize grips. Null
     when the engine didn't tag a plot area (e.g. faceted figures). */
  const [plotRect, setPlotRect] =
    useState<{ left: number; top: number; width: number; height: number } | null>(null);

  /* keep the resize handle glued to the SVG's bottom-right corner */
  const placeHandle = () => {
    const el = host.current, h = handle.current;
    const svg = el?.querySelector("svg");
    if (!el || !h || !svg) return;
    const er = el.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    h.style.left = `${sr.right - er.left - 7}px`;
    h.style.top = `${sr.bottom - er.top - 7}px`;
  };

  /* the engine tags the axes background <g id="plot-area"> (unfaceted only); its
     screen rect is the draggable plot area. Grips sit at its corners. */
  const placePlotHandles = () => {
    const el = host.current;
    const pa = el?.querySelector("#plot-area") as SVGGraphicsElement | null;
    if (!el || !pa) { setPlotRect(null); return; }
    const er = el.getBoundingClientRect();
    const pr = pa.getBoundingClientRect();
    setPlotRect({ left: pr.left - er.left, top: pr.top - er.top,
                  width: pr.width, height: pr.height });
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
    /* true-ish scale (96 dpi), shrink-to-fit in narrow panes */
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = `${vb.width * PX_PER_PT}px`;
    svg.style.maxWidth = "100%";
    svg.style.height = "auto";
    setDims({ w: Math.round(vb.width / PT_PER_MM), h: Math.round(vb.height / PT_PER_MM) });
    placeHandle();
    placePlotHandles();
    const ro = new ResizeObserver(() => { placeHandle(); placePlotHandles(); });
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
      g.addEventListener("pointerdown", (e0) => {
        e0.preventDefault();
        const s = scale();
        let dx = 0, dy = 0;
        const move = (e: PointerEvent) => {
          dx = (e.clientX - e0.clientX) * s;
          dy = (e.clientY - e0.clientY) * s;
          g.setAttribute("transform", `translate(${dx} ${dy})`);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          setStyle((st) => {
            const prev = st.offsets?.[gid] ?? [0, 0];
            return { ...st, offsets: { ...st.offsets, [gid]: [prev[0] + dx, prev[1] + dy] } };
          });
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
    }
    return () => ro.disconnect();
  }, [analysis]);

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
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.maxWidth = "none";
    /* back to the shrink-to-fit display the SVG-injection effect sets up */
    const restoreFit = () => {
      svg.removeAttribute("preserveAspectRatio");
      svg.style.width = `${vb.width * PX_PER_PT}px`;
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      placeHandle();
    };
    const dimsFor = (e: PointerEvent) => ({
      w: Math.max(40, Math.round(dims.w + (e.clientX - e0.clientX) / PX_PER_PT / PT_PER_MM)),
      h: Math.max(30, Math.round(dims.h + (e.clientY - e0.clientY) / PX_PER_PT / PT_PER_MM)),
    });
    const move = (e: PointerEvent) => {
      const { w, h } = dimsFor(e);
      svg.style.width = `${w * PT_PER_MM * PX_PER_PT}px`;
      svg.style.height = `${h * PT_PER_MM * PX_PER_PT}px`;
      setResizing(`${w} × ${h} mm`);
      placeHandle();
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(null);
      const { w, h } = dimsFor(e);
      /* drop the stretched preview either way; a real change re-renders, an
         unchanged release just returns to the fit display */
      restoreFit();
      if (w !== dims.w || h !== dims.h)
        setStyle((st) => ({ ...st, width_mm: w, height_mm: h }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* plot-area move/resize: drag a corner grip to reposition or resize the axes
     inside the canvas, committed as `axes_rect` (figure fractions, y up). The
     canvas itself is sized independently by the corner handle above, so growing
     the canvas and pulling the plot area aside frees a strip the legend can be
     dragged into — "docking" it on the extended canvas. Grips move live; the
     figure re-renders at the committed rect on release. */
  const onPlotDrag = (mode: "move" | "resize") => (e0: ReactPointerEvent) => {
    const el = host.current;
    const svg = el?.querySelector("svg");
    const pa = el?.querySelector("#plot-area") as SVGGraphicsElement | null;
    if (!el || !svg || !pa || !plotRect) return;
    e0.preventDefault();
    e0.stopPropagation();
    const sr = svg.getBoundingClientRect();
    /* current axes rect as figure fractions (y down for top) */
    const left0 = (pa.getBoundingClientRect().left - sr.left) / sr.width;
    const top0 = (pa.getBoundingClientRect().top - sr.top) / sr.height;
    const w0 = pa.getBoundingClientRect().width / sr.width;
    const h0 = pa.getBoundingClientRect().height / sr.height;
    const start = plotRect;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - e0.clientX, dy = e.clientY - e0.clientY;
      setPlotRect(mode === "move"
        ? { ...start, left: start.left + dx, top: start.top + dy }
        : { ...start, width: Math.max(24, start.width + dx),
            height: Math.max(24, start.height + dy) });
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const dx = e.clientX - e0.clientX, dy = e.clientY - e0.clientY;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { placePlotHandles(); return; }
      const cl = (v: number) => Math.max(0, Math.min(1, v));
      let rect: [number, number, number, number];
      if (mode === "move") {
        const top = top0 + dy / sr.height;
        rect = [cl(left0 + dx / sr.width), cl(1 - (top + h0)), w0, h0];
      } else {
        const width = Math.min(1, Math.max(0.1, w0 + dx / sr.width));
        const height = Math.min(1, Math.max(0.1, h0 + dy / sr.height));
        rect = [left0, cl(1 - (top0 + height)), width, height];
      }
      setStyle((st) => ({ ...st, axes_rect: rect }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nExcluded = tableHandle?.counts?.excluded ?? 0;
  return (
    <section className="pane figure-pane">
      <div className="pane-head">
        <h2>Figure</h2>
        {analysis && (
          <span className="provenance">
            {resizing ?? (dims && `${dims.w} × ${dims.h} mm`)}
            {nExcluded > 0 && ` · ${nExcluded} excluded`}
          </span>
        )}
      </div>
      <div className="figure-frame">
        <div ref={host} className="figure-host" />
        {analysis && (
          <div ref={handle} className="resize-handle" title="drag to resize the canvas (mm)"
            onPointerDown={onResizeStart} />
        )}
        {analysis && plotRect && (
          <>
            <div className="plot-move" title="drag to move the plot area"
              style={{ left: plotRect.left - 7, top: plotRect.top - 7 }}
              onPointerDown={onPlotDrag("move")} />
            <div className="plot-resize" title="drag to resize the plot area"
              style={{ left: plotRect.left + plotRect.width - 7,
                       top: plotRect.top + plotRect.height - 7 }}
              onPointerDown={onPlotDrag("resize")} />
          </>
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
      <p className="hint">
        Drag labels or the legend to reposition. Drag the canvas corner to resize
        the figure, or the plot-area corners to move/resize the axes within it —
        exports match. Exclude rows from the Data table.
      </p>
      <StylePane />
    </section>
  );
}
