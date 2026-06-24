import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState,
  type Node, type Edge as RFEdge, type NodeTypes, type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSetAtom, useAtomValue } from "jotai";
import type { ExplorerGraph } from "../explorer/graph";
import { layoutGraph } from "./layout";
import { ArrayShapeRFNode, nodeShapeProps } from "./ArrayShapeRFNode";
import { WorkbenchEdge } from "./WorkbenchEdge";
import { openCardAtom, collapseAllCardsAtom, cardsAtom } from "./state";
import { targetToCardKind, type Target } from "./cardRegistry";
import { FloatingCard } from "./FloatingCard";

// the custom node/edge components intentionally accept a narrower prop shape than
// React Flow's NodeProps/EdgeProps (they read only `data`); cast for registration.
const nodeTypes = { arrayShape: ArrayShapeRFNode } as unknown as NodeTypes;
const edgeTypes = { workbench: WorkbenchEdge } as unknown as EdgeTypes;

function toRF(graph: ExplorerGraph): { nodes: Node[]; edges: RFEdge[] } {
  const L = layoutGraph(graph);
  return {
    nodes: L.nodes.map((n) => ({
      id: n.id, type: "arrayShape", position: { x: n.x, y: n.y },
      data: nodeShapeProps(n.node) as unknown as Record<string, unknown>,
    })),
    edges: L.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, type: "workbench",
      data: { kind: e.kind, label: e.label, back: e.back },
    })),
  };
}

function Canvas({ graph, onClose }: { graph: ExplorerGraph; onClose?: () => void }) {
  const initial = useMemo(() => toRF(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  const openCard = useSetAtom(openCardAtom);
  const collapseAll = useSetAtom(collapseAllCardsAtom);
  const cards = useAtomValue(cardsAtom);

  // resolve a click target to its card kind and open (or re-select) it. A stale
  // id (kind === null) is ignored — the structure changed under the click.
  const open = useCallback((target: Target) => {
    const kind = targetToCardKind(graph, target);
    if (kind) openCard({ target, cardKind: kind });
  }, [graph, openCard]);

  // the structural identity of the graph: the SET of node + edge ids. Layout
  // (positions) is recomputed only when this changes — not on every
  // explorerGraphAtom recompute (those fire on each /shape_counts result and
  // would otherwise clobber user-dragged positions).
  const structureKey = useMemo(
    () => graph.nodes.map((n) => n.id).join(",") + "|" + graph.edges.map((e) => e.id).join(","),
    [graph],
  );
  const lastStructure = useRef<string>("");

  useEffect(() => {
    const rf = toRF(graph);
    if (structureKey !== lastStructure.current) {
      // structure changed (step/grain/terminal/annotate added or removed):
      // full re-layout with fresh positions.
      lastStructure.current = structureKey;
      setNodes(rf.nodes);
      setEdges(rf.edges);
    } else {
      // same structure, data-only change (counts, guard verdicts, labels):
      // update data in place, preserving any positions the user dragged.
      const nd = new Map(rf.nodes.map((n) => [n.id, n.data]));
      const ed = new Map(rf.edges.map((e) => [e.id, e.data]));
      setNodes((cur) => cur.map((n) => ({ ...n, data: nd.get(n.id) ?? n.data })));
      setEdges((cur) => cur.map((e) => ({ ...e, data: ed.get(e.id) ?? e.data })));
    }
  }, [graph, structureKey, setNodes, setEdges]);

  // "tidy" re-layouts from scratch, discarding dragged positions.
  const tidy = useCallback(() => {
    const rf = toRF(graph);
    setNodes(rf.nodes);
    setEdges(rf.edges);
  }, [graph, setNodes, setEdges]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txw-overlay" role="dialog" aria-label="Transformation workbench">
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workbench</h1>
        <button className="txw-tidy" onClick={tidy}>⤢ Tidy</button>
        <button className="txw-collapse-all" onClick={collapseAll}>⊟ Collapse all</button>
        {onClose && (
          <button className="txw-close" onClick={onClose} aria-label="Close workbench">✕</button>
        )}
      </div>
      <div className="txw-rfcanvas">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={(_e, n) => open({ kind: "node", id: n.id })}
          onEdgeClick={(_e, ed) => open({ kind: "edge", id: ed.id })}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          fitView proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <div className="txw-cards">
        {cards.map((c) => <FloatingCard key={c.id} card={c} />)}
      </div>
    </div>
  );
}

export function WorkbenchCanvas({ graph, onClose }: { graph: ExplorerGraph; onClose?: () => void }) {
  return (
    <ReactFlowProvider>
      <Canvas graph={graph} onClose={onClose} />
    </ReactFlowProvider>
  );
}
