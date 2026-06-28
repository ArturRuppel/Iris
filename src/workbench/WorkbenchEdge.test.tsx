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
    const { container } = renderEdge({ kind: "geom", label: "dots" });
    const path = container.querySelector(".react-flow__edge-path.txw-rfedge.geom");
    expect(path).not.toBeNull();
    expect(container.querySelector(".txw-rfedge-label")).toBeNull(); // label moved into the node
  });
});

// X spans: FAR puts the target more than one column away (lane territory); ADJ
// puts it in the immediately adjacent column (route inline, no detour).
const FAR = 400, ADJ = 74;
describe("laneOf (fan-in routing)", () => {
  it("lifts a far on-row geom edge into a top lane (above source)", () => {
    expect(laneOf("geom", 0, 100, FAR, 100)!).toBeLessThan(100);
  });
  it("drops a far on-row test edge into a bottom lane (below source)", () => {
    expect(laneOf("test", 0, 100, FAR, 100)!).toBeGreaterThan(100);
  });
  it("routes straight to the target's row when it's far and stacked off-row", () => {
    expect(laneOf("geom", 0, 0, FAR, 300)).toBe(300);
    expect(laneOf("test", 0, 0, FAR, 300)).toBe(300);
  });
  it("routes a fan-in to an ADJACENT column inline (no lane, no loop)", () => {
    expect(laneOf("test", 0, 100, ADJ, 100)).toBeNull(); // last grain -> Stats next door
    expect(laneOf("geom", 0, 0, ADJ, 150)).toBeNull();   // grain -> Plot stacked just off it
  });
  it("returns null for a normal inline edge (no lane)", () => {
    expect(laneOf("collapse", 0, 0, FAR, 0)).toBeNull();
    expect(laneOf(undefined, 0, 0, FAR, 0)).toBeNull();
  });
});
