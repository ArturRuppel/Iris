import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  activePlottableAtom, analysisAtom, rowsAtom, selectedRowIdAtom, toggleExclusionAtom,
} from "../state";
import type { StyleOverrides } from "../types";
import { StylePane } from "./StylePane";

const SVGNS = "http://www.w3.org/2000/svg";

/* gid-tagged text the engine marks as draggable (title, axis labels, the
   r/p or median annotation) */
const DRAGGABLE = ["lbl-title", "lbl-x", "lbl-y", "lbl-annot"];

const PT_PER_MM = 72 / 25.4;
const PX_PER_PT = 96 / 72;

/** Renders the engine's SVG and attaches interactivity.
 *  Contract: each point group is <g id="pts-i"> whose k-th <use> element
 *  corresponds to point_groups[i].row_ids[k] (validated by engine tests).
 *  Clicking a point selects it; exclusion is deliberate, via right-click.
 *  Labels drag (each gets a transparent hit-rect — the glyph strokes alone
 *  are unhittable); the corner handle drag-resizes in real mm. */
export function FigurePane() {
  const analysis = useAtomValue(analysisAtom);
  const rows = useAtomValue(rowsAtom);
  const toggle = useSetAtom(toggleExclusionAtom);
  const [selected, setSelected] = useAtom(selectedRowIdAtom);
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
  const useByRow = useRef<Map<string, SVGElement>>(new Map());
  const [menu, setMenu] = useState<{ x: number; y: number; rowId: string } | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);

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

  useEffect(() => {
    const el = host.current;
    if (!el || !analysis) return;
    el.innerHTML = analysis.figure.svg;
    setMenu(null);
    useByRow.current.clear();
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
    const ro = new ResizeObserver(placeHandle);
    ro.observe(el);

    /* points: click = select, right-click = context menu */
    for (const group of analysis.figure.point_groups) {
      const g = el.querySelector(`g#${CSS.escape(group.gid)}`);
      if (!g) continue;
      g.querySelectorAll("use").forEach((use, k) => {
        const rowId = group.row_ids[k];
        if (!rowId) return;
        useByRow.current.set(rowId, use as SVGElement);
        (use as SVGElement).style.cursor = "pointer";
        use.addEventListener("click", () =>
          setSelected((cur) => (cur === rowId ? null : rowId)));
        use.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          setSelected(rowId);
          setMenu({ x: e.clientX, y: e.clientY, rowId });
        });
        const title = document.createElementNS(SVGNS, "title");
        title.textContent = rowId;
        use.appendChild(title);
      });
    }

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
  }, [analysis, setSelected]);

  /* selection highlight, applied without re-injecting the SVG */
  useEffect(() => {
    useByRow.current.forEach((use, rowId) =>
      use.classList.toggle("pt-selected", rowId === selected));
  }, [selected, analysis]);

  /* corner handle: drag → live preview in px, commit in mm on release */
  const onResizeStart = (e0: ReactPointerEvent) => {
    const svg = host.current?.querySelector("svg");
    if (!svg || !dims) return;
    e0.preventDefault();
    const move = (e: PointerEvent) => {
      const w = Math.max(40, Math.round(dims.w + (e.clientX - e0.clientX) / PX_PER_PT / PT_PER_MM));
      const h = Math.max(30, Math.round(dims.h + (e.clientY - e0.clientY) / PX_PER_PT / PT_PER_MM));
      svg.style.width = `${w * PT_PER_MM * PX_PER_PT}px`;
      svg.style.height = `${h * PT_PER_MM * PX_PER_PT}px`;
      setResizing(`${w} × ${h} mm`);
      placeHandle();
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(null);
      const w = Math.max(40, Math.round(dims.w + (e.clientX - e0.clientX) / PX_PER_PT / PT_PER_MM));
      const h = Math.max(30, Math.round(dims.h + (e.clientY - e0.clientY) / PX_PER_PT / PT_PER_MM));
      if (w !== dims.w || h !== dims.h)
        setStyle((st) => ({ ...st, width_mm: w, height_mm: h }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const exclude = (rowId: string) => {
    toggle(rowId);
    setMenu(null);
    setSelected(null);
  };

  const nExcluded = rows.filter((r) => r.excluded).length;
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
        <div ref={host} className="figure-host"
          onClick={(e) => {
            setMenu(null);
            if ((e.target as Element).tagName !== "use") setSelected(null);
          }} />
        {analysis && (
          <div ref={handle} className="resize-handle" title="drag to resize (mm)"
            onPointerDown={onResizeStart} />
        )}
      </div>
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
            <button onClick={() => exclude(menu.rowId)}>
              Exclude {menu.rowId} from analysis
            </button>
            <button onClick={() => setMenu(null)}>Cancel</button>
          </div>
        </>
      )}
      <p className="hint">
        Click a point to select it; right-click to exclude. Drag labels to
        reposition, drag the corner handle to resize — exports match.
      </p>
      <StylePane />
    </section>
  );
}
