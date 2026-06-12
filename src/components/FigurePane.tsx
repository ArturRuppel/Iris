import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { analysisAtom, rowsAtom, toggleExclusionAtom } from "../state";

/** Renders the engine's SVG and attaches interactivity.
 *  Contract: each point group is <g id="pts-i"> whose k-th <use> element
 *  corresponds to point_groups[i].row_ids[k] (validated by engine tests). */
export function FigurePane() {
  const analysis = useAtomValue(analysisAtom);
  const rows = useAtomValue(rowsAtom);
  const toggle = useSetAtom(toggleExclusionAtom);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !analysis) return;
    el.innerHTML = analysis.figure.svg;
    const svg = el.querySelector("svg");
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.width = "100%";
      svg.style.height = "auto";
    }
    for (const group of analysis.figure.point_groups) {
      const g = el.querySelector(`g#${CSS.escape(group.gid)}`);
      if (!g) continue;
      g.querySelectorAll("use").forEach((use, k) => {
        const rowId = group.row_ids[k];
        if (!rowId) return;
        (use as SVGElement).style.cursor = "pointer";
        use.addEventListener("click", () => toggle(rowId));
        use.addEventListener("mouseenter", () => use.setAttribute("opacity", "1"));
        use.addEventListener("mouseleave", () => use.removeAttribute("opacity"));
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = `${rowId} — click to exclude`;
        use.appendChild(title);
      });
    }
  }, [analysis, toggle]);

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
      <div ref={host} className="figure-host" />
      <p className="hint">Click a point to exclude it. The table, test, and n update together.</p>
    </section>
  );
}
