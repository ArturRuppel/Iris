import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkbenchCanvas } from "./WorkbenchCanvas";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "step:0", kind: "table", label: "filtered", table: { via: "at_step", at_step: 0 } },
    { id: "plot", kind: "plot", label: "Plot", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "step:0" },
    { id: "g0", kind: "geom", label: "dots", fromId: "step:0", toId: "plot" },
  ],
};

describe("WorkbenchCanvas", () => {
  it("renders one React Flow node per graph node, plus a tidy control", () => {
    const { container } = render(<WorkbenchCanvas graph={graph} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tidy/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
  });

  it("closes on the close control", () => {
    let closed = false;
    render(<WorkbenchCanvas graph={graph} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toBe(true);
  });

  it("re-flows when the graph structure changes (adds a node)", () => {
    const { container, rerender } = render(<WorkbenchCanvas graph={graph} onClose={() => {}} />);
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    const bigger: ExplorerGraph = {
      nodes: [...graph.nodes,
        { id: "step:1", kind: "table", label: "derived", table: { via: "at_step", at_step: 1 } }],
      edges: [...graph.edges,
        { id: "e1", kind: "derive", label: "x = 1", fromId: "step:0", toId: "step:1" }],
    };
    rerender(<WorkbenchCanvas graph={bigger} onClose={() => {}} />);
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(4);
  });
});
