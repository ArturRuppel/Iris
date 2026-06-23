import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import {
  activePlottableAtom, effectiveSchemaAtom, hierarchyAtom, selectedNodeIdAtom,
} from "../state";
import { buildGraph, type NodeKind } from "../explorer/graph";

/* The spec's color code. derive/recode/join are reserved for later steps; the
   MVP only renders source/filter/drop/flatten/outputs. */
const KIND_CLASS: Record<NodeKind, string> = {
  source: "tx-source",
  filter: "tx-filter",
  drop: "tx-drop",
  flatten: "tx-flatten",
  outputs: "tx-outputs",
};

const OUTPUTS_ID = "outputs";

/* One drawn fan-in arrow: an SVG path id + its `d`. The arrows bow BELOW the
   node line, from each grain a layer reads into the figure/stats node, so the
   figure's provenance is literally visible (a SuperPlot reads several → several
   arrows). Coordinates are measured from the live DOM after layout. */
interface Arrow { id: string; d: string }

export function TransformExplorer() {
  const active = useAtomValue(activePlottableAtom);
  const hierarchy = useAtomValue(hierarchyAtom);
  const schemaFull = useAtomValue(effectiveSchemaAtom);
  const [selectedId, setSelectedId] = useAtom(selectedNodeIdAtom);

  const graph = useMemo(
    () => active
      ? buildGraph(active.reduce.steps, hierarchy, active.layers, schemaFull)
      : null,
    [active, hierarchy, schemaFull],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [arrows, setArrows] = useState<Arrow[]>([]);

  /* Measure node positions and lay out the fan-in arrows. Re-runs when the graph
     changes and (via ResizeObserver) whenever the line reflows. */
  useLayoutEffect(() => {
    const cont = containerRef.current;
    if (!cont || !graph) { setArrows([]); return; }
    const measure = () => {
      const cb = cont.getBoundingClientRect();
      const out = nodeRefs.current.get(OUTPUTS_ID);
      if (!out) { setArrows([]); return; }
      const ob = out.getBoundingClientRect();
      const ox = ob.left - cb.left + ob.width / 2;
      const oy = ob.bottom - cb.top;
      const next: Arrow[] = [];
      for (const e of graph.fanIn) {
        if (e.fromId === OUTPUTS_ID) continue;
        const src = nodeRefs.current.get(e.fromId);
        if (!src) continue;
        const sb = src.getBoundingClientRect();
        const sx = sb.left - cb.left + sb.width / 2;
        const sy = sb.bottom - cb.top;
        const dip = Math.max(sy, oy) + 22;  // bow depth below the line
        next.push({
          id: `${e.fromId}->${e.toId}:${e.level}`,
          d: `M ${sx} ${sy} C ${sx} ${dip} ${ox} ${dip} ${ox} ${oy}`,
        });
      }
      setArrows(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cont);
    return () => ro.disconnect();
  }, [graph]);

  if (!active || !graph) return null;

  // selection defaults to outputs (DataTab's fallback), so highlight it too.
  const outputsId = graph.nodes.find((n) => n.kind === "outputs")?.id ?? null;
  const effectiveId = graph.nodes.some((n) => n.id === selectedId)
    ? selectedId : outputsId;

  // the grain levels feeding outputs, named for the outputs node's tooltip.
  const fanInLabels = graph.fanIn.map((e) =>
    e.level === "" ? "raw" : (graph.nodes.find((n) => n.id === e.fromId)?.label ?? e.level));

  return (
    <div className="tx-explorer" ref={containerRef}>
      <ol className="tx-line">
        {graph.nodes.map((node, i) => (
          <li key={node.id} className="tx-node-wrap">
            {i > 0 && <span className="tx-arrow" aria-hidden>→</span>}
            <button
              ref={(el) => {
                if (el) nodeRefs.current.set(node.id, el);
                else nodeRefs.current.delete(node.id);
              }}
              className={`tx-node ${KIND_CLASS[node.kind]}${effectiveId === node.id ? " on" : ""}`}
              title={node.kind === "outputs"
                ? `Figure / stats — reads: ${fanInLabels.join(", ")}`
                : `Show the table at this node (${node.kind})`}
              onClick={() => setSelectedId(node.id)}>
              <span className="tx-node-label">{node.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <svg className="tx-fanin-svg" aria-hidden>
        <defs>
          <marker id="tx-arrowhead" markerWidth="7" markerHeight="7"
            refX="5.5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#7c3aed" />
          </marker>
        </defs>
        {arrows.map((a) => (
          <path key={a.id} d={a.d} className="tx-fanin-path"
            markerEnd="url(#tx-arrowhead)" />
        ))}
      </svg>
    </div>
  );
}
