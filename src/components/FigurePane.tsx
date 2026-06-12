import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import {
  analysisAtom, rowsAtom, selectedRowIdAtom, styleAtom, toggleExclusionAtom,
} from "../state";
import { StylePane } from "./StylePane";

/* gid-tagged text the engine marks as draggable (title, axis labels, the
   r/p or median annotation) */
const DRAGGABLE = ["lbl-title", "lbl-x", "lbl-y", "lbl-annot"];

/** Renders the engine's SVG and attaches interactivity.
 *  Contract: each point group is <g id="pts-i"> whose k-th <use> element
 *  corresponds to point_groups[i].row_ids[k] (validated by engine tests).
 *  Clicking a point selects it; exclusion is deliberate, via right-click.
 *  Labels drag; the offset goes into spec.style.overrides.offsets so the
 *  engine re-renders (and exports) them at the dropped position. */
export function FigurePane() {
  const analysis = useAtomValue(analysisAtom);
  const rows = useAtomValue(rowsAtom);
  const toggle = useSetAtom(toggleExclusionAtom);
  const [selected, setSelected] = useAtom(selectedRowIdAtom);
  const setStyle = useSetAtom(styleAtom);
  const host = useRef<HTMLDivElement>(null);
  const useByRow = useRef<Map<string, SVGElement>>(new Map());
  const [menu, setMenu] = useState<{ x: number; y: number; rowId: string } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !analysis) return;
    el.innerHTML = analysis.figure.svg;
    setMenu(null);
    useByRow.current.clear();
    const svg = el.querySelector("svg");
    if (!svg) return;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "auto";

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
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = rowId;
        use.appendChild(title);
      });
    }

    /* labels: drag to move; viewBox units == engine pt, so the committed
       offset is resolution-independent */
    const scale = () => {
      const vb = svg.viewBox.baseVal;
      return vb && vb.width ? vb.width / svg.getBoundingClientRect().width : 1;
    };
    for (const gid of DRAGGABLE) {
      const g = el.querySelector(`g#${CSS.escape(gid)}`) as SVGGElement | null;
      if (!g) continue;
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
  }, [analysis, setSelected, setStyle]);

  /* selection highlight, applied without re-injecting the SVG */
  useEffect(() => {
    useByRow.current.forEach((use, rowId) =>
      use.classList.toggle("pt-selected", rowId === selected));
  }, [selected, analysis]);

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
            scipy {analysis.engine_snapshot.scipy} · pingouin {analysis.engine_snapshot.pingouin}
            {nExcluded > 0 && ` · ${nExcluded} excluded`}
          </span>
        )}
      </div>
      <div ref={host} className="figure-host"
        onClick={(e) => {
          setMenu(null);
          if ((e.target as Element).tagName !== "use") setSelected(null);
        }} />
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
        Click a point to select it; right-click to exclude. Drag the title and
        axis labels to reposition them — exports match.
      </p>
      <StylePane />
    </section>
  );
}
