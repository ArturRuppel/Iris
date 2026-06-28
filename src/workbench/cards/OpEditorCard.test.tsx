import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { OpEditorCard, edgeIdToStepIndex } from "./OpEditorCard";
import { seedStore } from "./cardTestStore";
import { activePlottableAtom } from "../../state";
import { explorerGraphAtom } from "../../explorer/graphAtom";
import type { ExplorerGraph } from "../../explorer/graph";

describe("edgeIdToStepIndex", () => {
  const graph: ExplorerGraph = {
    nodes: [
      { id: "step:2", kind: "table", phase: "reduce", stepIndex: 2,
        label: "filtered", table: { via: "at_step", at_step: 2 } },
      { id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" } },
    ],
    edges: [
      { id: "e:step:1->step:2", kind: "filter", label: "mask",
        fromId: "step:1", toId: "step:2" },
      { id: "g:plain", kind: "geom", label: "plotted",
        fromId: "source", toId: "figure" },
    ],
    spine: [],
  };

  it("returns the step index for a step-edge id", () => {
    expect(edgeIdToStepIndex(graph, "e:step:1->step:2")).toBe(2);
  });

  it("returns null for a non-step edge", () => {
    expect(edgeIdToStepIndex(graph, "g:plain")).toBeNull();
  });

  it("returns null for an unknown edge id", () => {
    expect(edgeIdToStepIndex(graph, "nope")).toBeNull();
  });
});

describe("OpEditorCard", () => {
  it("renders the filter editor for a filter step-edge and persists edits", () => {
    const { store, plottable } = seedStore();
    store.set(activePlottableAtom, {
      ...plottable,
      reduce: { steps: [{ kind: "filter", _key: "k1", conditions: [] }] },
    });
    const graph = store.get(explorerGraphAtom)!;
    const edge = graph.edges.find((e) => e.kind === "filter")!;
    render(
      <Provider store={store}>
        <OpEditorCard target={{ kind: "edge", id: edge.id }} />
      </Provider>,
    );
    const addBtn = screen.getByText("+ condition");
    expect(addBtn).toBeInTheDocument();
    fireEvent.click(addBtn);
    const step = store.get(activePlottableAtom)!.reduce.steps[0];
    expect(step.kind).toBe("filter");
    expect((step as { conditions: unknown[] }).conditions.length).toBe(1);
  });

  it("renders a stale-step notice when the index is gone", () => {
    const { store, plottable } = seedStore();
    store.set(activePlottableAtom, {
      ...plottable,
      reduce: { steps: [{ kind: "filter", _key: "k1", conditions: [] }] },
    });
    const graph = store.get(explorerGraphAtom)!;
    const edge = graph.edges.find((e) => e.kind === "filter")!;
    // now empty the pipeline so the resolved index is out of range
    store.set(activePlottableAtom, { ...plottable, reduce: { steps: [] } });
    render(
      <Provider store={store}>
        <OpEditorCard target={{ kind: "edge", id: edge.id }} />
      </Provider>,
    );
    expect(screen.getByTestId("op-editor-card").textContent)
      .toMatch(/no longer in the pipeline/i);
  });
});
