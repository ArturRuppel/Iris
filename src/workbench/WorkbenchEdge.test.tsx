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
const edge = (kind: string, label: string): Edge[] => [
  { id: "e0", source: "a", target: "b", type: "workbench",
    data: { kind, label, back: false } },
];

const renderEdge = (edges: Edge[]) =>
  render(
    <ReactFlowProvider>
      <div style={{ width: 400, height: 300 }}>
        <ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} />
      </div>
    </ReactFlowProvider>,
  );

/* the label wrapper is translated to (labelX, labelY); pull labelY back out of
   the transform so we can assert which lane the label rides in. Nodes a/b sit at
   y=0 with handles at y=25, so the inline corridor is ~y=25. */
const labelY = (text: string): number => {
  const el = screen.getByText(text).closest(".txw-rfedge-label") as HTMLElement;
  const m = /translate\(-50%,-50%\) translate\([-\d.]+px,([-\d.]+)px\)/.exec(el.style.transform);
  if (!m) throw new Error(`no labelY in transform: ${el.style.transform}`);
  return Number(m[1]);
};

describe("WorkbenchEdge", () => {
  it("renders the edge label inside a canvas", () => {
    renderEdge(edge("geom", "dots"));
    expect(screen.getByText("dots")).toBeInTheDocument();
  });

  it("lifts a geom (Plot) label into the top lane, clear of the inline row", () => {
    renderEdge(edge("geom", "dots"));
    // -LANE_Y from the (min) handle y of 25 -> well above the inline corridor.
    expect(labelY("dots")).toBeLessThan(0);
  });

  it("drops a test (Stats) label into the bottom lane", () => {
    renderEdge(edge("test", "MW"));
    expect(labelY("MW")).toBeGreaterThan(50);
  });

  it("keeps a collapse label on the inline corridor (no lane offset)", () => {
    renderEdge(edge("collapse", "median over x"));
    // stays near the handle row (~25), neither lane.
    const y = labelY("median over x");
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(50);
  });
});
