import { useLayoutEffect, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { selectedNodeIdAtom } from "../state";
import { explorerGraphAtom } from "../explorer/graphAtom";
import type { EdgeKind } from "../explorer/graph";

/* Honest dataflow: NODES ARE DATA (table/plot/stats), EDGES ARE
   TRANSFORMATIONS (filter/drop/collapse/geom/test). Edges are drawn as colored,
   labeled SVG arrows measured from the live DOM. */
const EDGE_COLOR: Record<EdgeKind, string> = {
  filter: "#e11d48", drop: "#d97706", collapse: "#7c3aed",
  geom: "#0e7490", test: "#4f46e5",
};
const EDGE_KINDS: EdgeKind[] = ["filter", "drop", "collapse", "geom", "test"];

/* A laid-out edge: its `d` path, its color, and the label + label position. */
interface DrawnEdge {
  id: string;
  kind: EdgeKind;
  d: string;
  color: string;
  label: string;
  lx: number;
  ly: number;
}

export function TransformExplorer() {
  const graph = useAtomValue(explorerGraphAtom);
  const [selectedId, setSelectedId] = useAtom(selectedNodeIdAtom);

  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [drawn, setDrawn] = useState<DrawnEdge[]>([]);

  /* Measure node positions and lay out every edge as an arrow. Re-runs when the
     graph changes and (via ResizeObserver) whenever the line reflows. */
  useLayoutEffect(() => {
    const cont = containerRef.current;
    if (!cont || !graph) { setDrawn([]); return; }

    const measure = () => {
      const cb = cont.getBoundingClientRect();
      // index of each node on the line, to detect immediate-neighbor (chain) edges.
      const order = new Map<string, number>();
      graph.nodes.forEach((n, i) => order.set(n.id, i));

      const next: DrawnEdge[] = [];
      let belowIdx = 0;  // staggers below-line edges so they don't overlap.

      for (const e of graph.edges) {
        const from = nodeRefs.current.get(e.fromId);
        const to = nodeRefs.current.get(e.toId);
        if (!from || !to) continue;
        const fb = from.getBoundingClientRect();
        const tb = to.getBoundingClientRect();

        const fi = order.get(e.fromId) ?? 0;
        const ti = order.get(e.toId) ?? 0;
        const isChain = ti - fi === 1;  // immediate left neighbor
        const color = EDGE_COLOR[e.kind];

        if (isChain) {
          // short hop ABOVE the row: right-edge-of-from -> left-edge-of-to.
          const sx = fb.right - cb.left;
          const sy = fb.top - cb.top;
          const ex = tb.left - cb.left;
          const ey = tb.top - cb.top;
          const lift = Math.min(sy, ey) - 14;  // bow up above the line
          const mx = (sx + ex) / 2;
          next.push({
            id: e.id, kind: e.kind, color, label: e.label,
            d: `M ${sx} ${sy} C ${sx} ${lift} ${ex} ${lift} ${ex} ${ey}`,
            lx: mx, ly: lift - 3,
          });
        } else {
          // long span (geom/test, often skipping nodes): bow BELOW the line,
          // staggered by belowIdx so multiple paths/labels don't overlap.
          const sx = fb.left - cb.left + fb.width / 2;
          const sy = fb.bottom - cb.top;
          const ex = tb.left - cb.left + tb.width / 2;
          const ey = tb.bottom - cb.top;
          const dip = Math.max(sy, ey) + 22 + belowIdx * 14;
          belowIdx += 1;
          const mx = (sx + ex) / 2;
          next.push({
            id: e.id, kind: e.kind, color, label: e.label,
            d: `M ${sx} ${sy} C ${sx} ${dip} ${ex} ${dip} ${ex} ${ey}`,
            lx: mx, ly: dip + 4,
          });
        }
      }
      setDrawn(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cont);
    return () => ro.disconnect();
  }, [graph]);

  if (!graph) return null;

  /* Highlight the selected node; if nothing/stale is selected fall back to the
     plot node (mirrors the data tab's default). */
  const plotId = graph.nodes.find((n) => n.kind === "plot")?.id ?? null;
  const effectiveId = graph.nodes.some((n) => n.id === selectedId)
    ? selectedId : plotId;

  const onClickNode = (id: string, kind: string) => {
    setSelectedId(id);
    if (kind === "plot") {
      document.getElementById("section-figure")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (kind === "stats") {
      document.getElementById("section-stats")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const title = (kind: string) =>
    kind === "plot" ? "Show & scroll to the figure"
      : kind === "stats" ? "Show & scroll to the stats"
        : "Show this table in the data tab";

  return (
    <div className="tx-explorer" ref={containerRef}>
      <ol className="tx-line">
        {graph.nodes.map((node) => (
          <li key={node.id} className="tx-node-wrap">
            <button
              ref={(el) => {
                if (el) nodeRefs.current.set(node.id, el);
                else nodeRefs.current.delete(node.id);
              }}
              className={`tx-node tx-${node.kind}${effectiveId === node.id ? " on" : ""}`}
              title={title(node.kind)}
              onClick={() => onClickNode(node.id, node.kind)}>
              <span className="tx-node-label">{node.label}</span>
              {node.count && (
                <span className="tx-node-count">
                  {node.count.rows}×{node.count.cols}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
      <svg className="tx-fanin-svg" aria-hidden>
        <defs>
          {/* one arrowhead marker per color, referenced by edge kind */}
          {EDGE_KINDS.map((k) => (
            <marker key={k} id={`tx-arrow-${k}`} markerWidth="7" markerHeight="7"
              refX="5.5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={EDGE_COLOR[k]} />
            </marker>
          ))}
        </defs>
        {drawn.map((e) => (
          <g key={e.id}>
            <path d={e.d} className="tx-fanin-path" stroke={e.color}
              markerEnd={`url(#tx-arrow-${e.kind})`} />
            <text className="tx-edge-label" x={e.lx} y={e.ly} fill={e.color}
              textAnchor="middle">{e.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
