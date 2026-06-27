import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, Position, type Node, type Edge } from "@xyflow/react";
import { WorkbenchEdge, laneOf } from "./WorkbenchEdge";

const edgeTypes = { workbench: WorkbenchEdge };
/* Pre-supply measured dimensions and handles so React Flow considers nodes
   initialized on the first render (jsdom's ResizeObserver mock is a no-op). */
const nodes: Node[] = [
  { id: "a", position: { x: 0, y: 0 }, data: {}, measured: { width: 100, height: 50 },
    handles: [
      { id: null, type: "source", position: Position.Right, x: 100, y: 25 },
      { id: null, type: "target", position: Position.Left, x: 0, y: 25 },
    ] },
  { id: "b", position: { x: 200, y: 0 }, data: {}, measured: { width: 100, height: 50 },
    handles: [
      { id: null, type: "source", position: Position.Right, x: 100, y: 25 },
      { id: null, type: "target", position: Position.Left, x: 0, y: 25 },
    ] },
];

const renderEdge = (data: Record<string, unknown>) =>
  render(
    <ReactFlowProvider>
      <div style={{ width: 400, height: 300 }}>
        <ReactFlow nodes={nodes} edges={[{ id: "e0", source: "a", target: "b", type: "workbench", data }]}
          edgeTypes={edgeTypes} />
      </div>
    </ReactFlowProvider>,
  );

describe("WorkbenchEdge", () => {
  it("draws a wire and carries the kind class, with no floating label", () => {
    const { container } = renderEdge({ kind: "geom", label: "dots", back: false });
    const path = container.querySelector(".react-flow__edge-path.txw-rfedge.geom");
    expect(path).not.toBeNull();
    expect(container.querySelector(".txw-rfedge-label")).toBeNull(); // label moved into the node
  });
});

describe("laneOf (fan-in routing)", () => {
  it("lifts an on-row geom edge into a top lane (above source)", () => {
    expect(laneOf("geom", 100, 100)!).toBeLessThan(100);
  });
  it("drops an on-row test edge into a bottom lane (below source)", () => {
    expect(laneOf("test", 100, 100)!).toBeGreaterThan(100);
  });
  it("routes straight to the target's row when it's stacked off-row (no detour)", () => {
    expect(laneOf("geom", 0, 300)).toBe(300);
    expect(laneOf("test", 0, 300)).toBe(300);
  });
  it("returns null for a normal inline edge (no lane)", () => {
    expect(laneOf("collapse", 0, 0)).toBeNull();
    expect(laneOf(undefined, 0, 0)).toBeNull();
  });
});
