import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  it("carries the node's phase-keyed + options (a step node gets reduce kinds)", () => {
    const mk = (id: string): ExplorerNode => ({ id, kind: "table", label: id, table: { via: "none" } });
    expect(nodeShapeProps(mk("step:0")).options?.some((o) => o.action.kind === "reduce")).toBe(true);
    // a join-input node has no + menu.
    expect(nodeShapeProps(mk("source:0")).options).toEqual([]);
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
  it("shows the + add handle on a reduce node and opens the menu on click", () => {
    const { container } = render(
      <ReactFlowProvider>
        <ArrayShapeRFNode
          id="step:0"
          data={nodeShapeProps({ id: "step:0", kind: "table", label: "filtered", table: { via: "none" } })}
          selected={false}
        />
      </ReactFlowProvider>,
    );
    const add = container.querySelector(".txw-handle-add");
    expect(add).not.toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(add!);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Filter rows" })).toBeInTheDocument();
  });
  it("a terminal node shows no + add handle", () => {
    const { container } = render(
      <ReactFlowProvider>
        <ArrayShapeRFNode
          id="plot"
          data={nodeShapeProps({ id: "plot", kind: "plot", label: "Plot", table: { via: "none" } })}
          selected={false}
        />
      </ReactFlowProvider>,
    );
    expect(container.querySelector(".txw-handle-add")).toBeNull();
  });
});
