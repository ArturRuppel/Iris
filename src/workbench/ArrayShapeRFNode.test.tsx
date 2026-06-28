import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ArrayShapeRFNode, nodeShapeProps } from "./ArrayShapeRFNode";
import type { ExplorerNode, NodePhase } from "../explorer/graph";

/* derive a node's phase from its id the same way buildGraph does, so fixtures
   stay one-liners. */
const phaseOf = (id: string): NodePhase =>
  id === "source" ? "source"
  : id.startsWith("source:") ? "join-input"
  : id.startsWith("grain:") ? "grain"
  : id.startsWith("post:") ? "post"
  : "reduce";

describe("nodeShapeProps", () => {
  it("maps a step node + delta to eyebrow / detail / grain / values", () => {
    const node: ExplorerNode = {
      id: "grain:exp", kind: "table", phase: "grain", label: "per Experiment", table: { via: "grain", grain: "exp" },
      count: { rows: 3, cols: 2, axes: [{ name: "experiment_id", n_levels: 3, ragged: false }],
        values: [{ name: "value", type: "numeric", grain: null }] },
    };
    const delta = {
      spine: ["experiment_id", "frame"], live: ["experiment_id"], shed: ["frame"], newValues: [],
      inEdge: { id: "e:c", kind: "collapse" as const, label: "median over frame" },
    };
    expect(nodeShapeProps(node, delta)).toMatchObject({
      variant: "grain", kind: "collapse", eyebrow: "Collapse", detail: "median over frame",
      spine: ["experiment_id", "frame"], live: ["experiment_id"], shed: ["frame"],
      values: [{ name: "value", type: "numeric", grain: null }],
      inEdge: { id: "e:c", kind: "collapse" },
    });
  });
  it("gives the source an eyebrow and no detail; terminals key off kind", () => {
    const mk = (id: string, kind: "table" | "plot" | "stats"): ExplorerNode =>
      ({ id, kind, phase: kind === "table" ? phaseOf(id) : "terminal", label: id, table: { via: "none" } });
    expect(nodeShapeProps(mk("source", "table"))).toMatchObject({ eyebrow: "Source", detail: "" });
    expect(nodeShapeProps(mk("plot", "plot"))).toMatchObject({ eyebrow: "Plot", kind: "geom" });
    expect(nodeShapeProps(mk("stats", "stats"))).toMatchObject({ eyebrow: "Stats", kind: "test" });
  });
  it("derives variant from id: source -> source, source:0 -> source, plain -> table", () => {
    const mk = (id: string): ExplorerNode => ({ id, kind: "table", phase: phaseOf(id), label: id, table: { via: "none" } });
    expect(nodeShapeProps(mk("source")).variant).toBe("source");
    expect(nodeShapeProps(mk("source:0")).variant).toBe("source");
    expect(nodeShapeProps(mk("step:1")).variant).toBe("table");
  });
  it("passes the node's missing flag through", () => {
    const mk = (id: string, missing?: boolean): ExplorerNode =>
      ({ id, kind: "table", phase: phaseOf(id), label: id, table: { via: "none" }, missing });
    expect(nodeShapeProps(mk("source:0", true)).missing).toBe(true);
    expect(nodeShapeProps(mk("source:0")).missing).toBeFalsy();
  });
  it("carries the node's phase-keyed + options (a step node gets reduce kinds)", () => {
    const mk = (id: string): ExplorerNode => ({ id, kind: "table", phase: phaseOf(id), label: id, table: { via: "none" } });
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
            id: "grain:cell", kind: "table", phase: "grain", label: "per Cell", table: { via: "grain", grain: "cell" },
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
            id: "source:0", kind: "table", phase: "join-input", label: "drop a table here",
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
          data={nodeShapeProps({ id: "step:0", kind: "table", phase: "reduce", label: "filtered", table: { via: "none" } })}
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
          data={nodeShapeProps({ id: "plot", kind: "plot", phase: "terminal", label: "Plot", table: { via: "none" } })}
          selected={false}
        />
      </ReactFlowProvider>,
    );
    expect(container.querySelector(".txw-handle-add")).toBeNull();
  });
});
