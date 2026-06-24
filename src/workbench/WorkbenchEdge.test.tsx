import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, Position, type Node, type Edge } from "@xyflow/react";
import { WorkbenchEdge } from "./WorkbenchEdge";

const edgeTypes = { workbench: WorkbenchEdge };
/* Pre-supply measured dimensions and handles so React Flow considers nodes
   initialized on the first render without a ResizeObserver firing (jsdom mock
   is a no-op, so handles are never computed from DOM; providing them directly
   satisfies isNodeInitialized and getEdgePosition, enabling edge rendering). */
const nodes: Node[] = [
  {
    id: "a", position: { x: 0, y: 0 }, data: {},
    measured: { width: 100, height: 50 },
    handles: [
      { id: null, type: "source", position: Position.Right, x: 100, y: 25 },
      { id: null, type: "target", position: Position.Left, x: 0, y: 25 },
    ],
  },
  {
    id: "b", position: { x: 200, y: 0 }, data: {},
    measured: { width: 100, height: 50 },
    handles: [
      { id: null, type: "source", position: Position.Right, x: 100, y: 25 },
      { id: null, type: "target", position: Position.Left, x: 0, y: 25 },
    ],
  },
];
const edges: Edge[] = [
  { id: "g0", source: "a", target: "b", type: "workbench",
    data: { kind: "geom", label: "dots", back: false } },
];

describe("WorkbenchEdge", () => {
  it("renders the edge label inside a canvas", () => {
    render(
      <ReactFlowProvider>
        <div style={{ width: 400, height: 300 }}>
          <ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} />
        </div>
      </ReactFlowProvider>,
    );
    expect(screen.getByText("dots")).toBeInTheDocument();
  });
});
