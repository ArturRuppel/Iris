import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrayShapeRFNode, nodeShapeProps } from "./ArrayShapeRFNode";
import type { ExplorerNode } from "../explorer/graph";

describe("nodeShapeProps", () => {
  it("maps a grain node's descriptor to ArrayShapeNode props", () => {
    const node: ExplorerNode = {
      id: "grain:cell", kind: "table", label: "per Cell", table: { via: "grain", grain: "cell" },
      count: { rows: 3, cols: 2, axes: [{ name: "cell", n_levels: 3, ragged: false }], values: [] },
    };
    expect(nodeShapeProps(node)).toMatchObject({
      title: "per Cell", variant: "grain",
      axes: [{ name: "cell", n_levels: 3, ragged: false }], values: [], rows: 3, cols: 2,
    });
  });
  it("derives variant from id: source -> source, source:0 -> source, plain -> table", () => {
    const mk = (id: string): ExplorerNode => ({ id, kind: "table", label: id, table: { via: "none" } });
    expect(nodeShapeProps(mk("source")).variant).toBe("source");
    expect(nodeShapeProps(mk("source:0")).variant).toBe("source");
    expect(nodeShapeProps(mk("step:1")).variant).toBe("table");
  });
  it("passes the node's missing flag through", () => {
    const mk = (id: string, missing?: boolean): ExplorerNode =>
      ({ id, kind: "table", label: id, table: { via: "none" }, missing });
    expect(nodeShapeProps(mk("source:0", true)).missing).toBe(true);
    expect(nodeShapeProps(mk("source:0")).missing).toBeFalsy();
  });
});

describe("ArrayShapeRFNode", () => {
  it("renders the node title from its data", () => {
    render(
      <ReactFlowProvider>
        <ArrayShapeRFNode
          id="grain:cell"
          data={nodeShapeProps({
            id: "grain:cell", kind: "table", label: "per Cell", table: { via: "grain", grain: "cell" },
            count: { rows: 3, cols: 2, axes: [], values: [] },
          })}
          selected={false}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("per Cell")).toBeInTheDocument();
  });
  it("renders an open 'missing' input handle when the node is missing", () => {
    const { container } = render(
      <ReactFlowProvider>
        <ArrayShapeRFNode
          id="source:0"
          data={nodeShapeProps({
            id: "source:0", kind: "table", label: "drop a table here",
            table: { via: "none" }, missing: true,
          })}
          selected={false}
        />
      </ReactFlowProvider>,
    );
    expect(container.querySelector(".txw-handle-missing")).not.toBeNull();
  });
});
