import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Panel, Position,
  useNodesState, useEdgesState,
  type Node, type Edge as RFEdge, type NodeTypes, type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSetAtom, useAtomValue } from "jotai";
import type { ExplorerGraph } from "../explorer/graph";
import { layoutGraph } from "./layout";
import { ArrayShapeRFNode, nodeShapeProps } from "./ArrayShapeRFNode";
import { nodeDeltas, spineOf, levelInitial } from "./nodeDelta";
import { WorkbenchEdge } from "./WorkbenchEdge";
import {
  openCardAtom, collapseAllCardsAtom, cardsAtom, nodePositionsAtom,
  pushStashAtom, stashAtom,
} from "./state";
import { targetToCardKind, type Target } from "./cardRegistry";
import { FloatingCard } from "./FloatingCard";
import { Stash } from "./Stash";

// the custom node/edge components intentionally accept a narrower prop shape than
// React Flow's NodeProps/EdgeProps (they read only `data`); cast for registration.
const nodeTypes = { arrayShape: ArrayShapeRFNode } as unknown as NodeTypes;
const edgeTypes = { workbench: WorkbenchEdge } as unknown as EdgeTypes;

/* the onNodeDragStop reducer: records a node's post-drag position into the
   override map, immutably. Kept pure so it's unit-testable (RF drag events don't
   fire under jsdom, so the handler delegates here and we test this directly). */
export function applyNudge(
  prev: Record<string, { x: number; y: number }>,
  id: string, x: number, y: number,
): Record<string, { x: number; y: number }> {
  return { ...prev, [id]: { x, y } };
}

export function toRF(
  graph: ExplorerGraph,
  overrides: Record<string, { x: number; y: number }>,
): { nodes: Node[]; edges: RFEdge[] } {
  const L = layoutGraph(graph);
  const deltas = nodeDeltas(graph);
  return {
    nodes: L.nodes.map((n) => ({
      id: n.id, type: "arrayShape",
      position: overrides[n.id] ?? { x: n.x, y: n.y },
      // wire from the right edge into the left edge: RF derives edge endpoints
      // from these node fields, not from the <Handle> dot placement.
      sourcePosition: Position.Right, targetPosition: Position.Left,
      data: nodeShapeProps(n.node, deltas.get(n.id)) as unknown as Record<string, unknown>,
    })),
    edges: L.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, type: "workbench",
      // bind to the named side handles so edges leave the right edge and enter
      // the left edge (otherwise RF falls back to a default bottom/top handle).
      sourceHandle: "out", targetHandle: "in",
      data: { kind: e.kind, label: e.label, back: e.back },
    })),
  };
}

/* the persistent grain legend: decodes the per-node segment glyphs (E, P, …) to
   their full level names, in nesting order, so the shedding bars are readable. */
function GrainLegend({ spine }: { spine: string[] }) {
  if (spine.length === 0) return null;
  return (
    <div className="txw-grain-legend">
      <span className="txw-gl-k">Grain</span>
      <span className="txw-gl-lvls">
        {spine.map((name, i) => (
          <span key={name} className="txw-gl-lvl">
            {i > 0 && <span className="txw-gl-chev" aria-hidden>›</span>}
            <span className="txw-gl-seg" aria-hidden>{levelInitial(name)}</span>
            {name}
          </span>
        ))}
      </span>
      <span className="txw-gl-note">each step pools one level →</span>
    </div>
  );
}

function Canvas({ graph, onClose }: { graph: ExplorerGraph; onClose?: () => void }) {
  const nodePositions = useAtomValue(nodePositionsAtom);
  const setNodePositions = useSetAtom(nodePositionsAtom);
  // nodePositions here seeds only the FIRST render; later changes flow through
  // the structural effect below.
  const initial = useMemo(() => toRF(graph, nodePositions), [graph, nodePositions]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  const openCard = useSetAtom(openCardAtom);
  const pushStash = useSetAtom(pushStashAtom);
  const collapseAll = useSetAtom(collapseAllCardsAtom);
  const cards = useAtomValue(cardsAtom);
  const stash = useAtomValue(stashAtom);
  const hasStash = stash.length > 0;

  // clicking a node pins its data card into the stash (docked, comparable),
  // never a floating popup. A stale id (kind === null) is ignored.
  const pinNode = useCallback((target: Target) => {
    const kind = targetToCardKind(graph, target);
    if (kind) pushStash({ target, cardKind: kind });
  }, [graph, pushStash]);

  // clicking an edge opens its editor as a floating card (a transient, focused
  // editing surface — distinct from the pinned reference cards).
  const openEdge = useCallback((target: Target) => {
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
    const rf = toRF(graph, nodePositions);
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
    // `nodePositions` is read but intentionally NOT a dep: including it would
    // force a full re-seed on every nudge and fight React Flow's internal drag
    // state. The effect re-seeds only on a structure change, reading the current
    // overrides at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, structureKey, setNodes, setEdges]);

  // "tidy" clears persisted nudges then re-layouts from scratch.
  const tidy = useCallback(() => {
    setNodePositions({});
    const rf = toRF(graph, {});
    setNodes(rf.nodes);
    setEdges(rf.edges);
  }, [graph, setNodes, setEdges, setNodePositions]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txw-overlay txw-embedded" role="dialog" aria-label="Transformation workbench">
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workbench</h1>
        <button className="txw-tidy" onClick={tidy}>⤢ Tidy</button>
        <button className="txw-collapse-all" onClick={collapseAll}>⊟ Collapse all</button>
        {onClose && (
          <button className="txw-close" onClick={onClose} aria-label="Close workbench">✕</button>
        )}
      </div>
      <div className={`txw-rfcanvas${hasStash ? " with-stash" : ""}`}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={(_e, n) => pinNode({ kind: "node", id: n.id })}
          onNodeDragStop={(_e, n) =>
            setNodePositions((prev) => applyNudge(prev, n.id, n.position.x, n.position.y))}
          onEdgeClick={(_e, ed) => openEdge({ kind: "edge", id: ed.id })}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          fitView proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1} color="#d7dee7" />
          <Controls />
          <Panel position="top-left"><GrainLegend spine={spineOf(graph)} /></Panel>
        </ReactFlow>
      </div>
      <div className={`txw-cards${hasStash ? " with-stash" : ""}`}>
        {cards.map((c) => <FloatingCard key={c.id} card={c} />)}
      </div>
      <Stash graph={graph} />
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
