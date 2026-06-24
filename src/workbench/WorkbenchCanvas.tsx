import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState,
  type Node, type Edge as RFEdge, type NodeTypes, type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ExplorerGraph } from "../explorer/graph";
import { layoutGraph } from "./layout";
import { ArrayShapeRFNode, nodeShapeProps } from "./ArrayShapeRFNode";
import { WorkbenchEdge } from "./WorkbenchEdge";

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

function Canvas({ graph, onClose }: { graph: ExplorerGraph; onClose: () => void }) {
  const initial = useMemo(() => toRF(graph), [graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, , onEdgesChange] = useEdgesState(initial.edges);

  // re-flow when the graph changes structurally; "tidy" reuses the same reset.
  const tidy = useCallback(() => setNodes(toRF(graph).nodes), [graph, setNodes]);
  useEffect(() => { setNodes(toRF(graph).nodes); }, [graph, setNodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txw-overlay" role="dialog" aria-label="Transformation workbench">
      <div className="txw-topbar">
        <h1 className="txw-title">⛁ Transformation workbench</h1>
        <button className="txw-tidy" onClick={tidy}>⤢ Tidy</button>
        <button className="txw-close" onClick={onClose} aria-label="Close workbench">✕</button>
      </div>
      <div className="txw-rfcanvas">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          fitView proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}

export function WorkbenchCanvas({ graph, onClose }: { graph: ExplorerGraph; onClose: () => void }) {
  return (
    <ReactFlowProvider>
      <Canvas graph={graph} onClose={onClose} />
    </ReactFlowProvider>
  );
}
