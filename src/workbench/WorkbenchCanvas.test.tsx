import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { WorkbenchCanvas, applyNudge, toRF } from "./WorkbenchCanvas";
import { cardsAtom, nodePositionsAtom, stashAtom } from "./state";
import { targetToCardKind } from "./cardRegistry";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "step:0", kind: "table", phase: "reduce", label: "filtered", table: { via: "at_step", at_step: 0 } },
    { id: "plot", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" } },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "step:0" },
    { id: "g0", kind: "geom", label: "dots", fromId: "step:0", toId: "plot" },
  ],
  spine: [],
};

function mount(g: ExplorerGraph = graph, onClose?: () => void) {
  const store = createStore();
  const utils = render(
    <Provider store={store}><WorkbenchCanvas graph={g} onClose={onClose} /></Provider>,
  );
  return { store, ...utils };
}

describe("WorkbenchCanvas", () => {
  it("renders one React Flow node per graph node, plus a tidy control", () => {
    const { container } = mount();
    expect(screen.getByRole("button", { name: /tidy/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
  });

  it("renders a close control only when onClose is provided", () => {
    const { rerender, store } = mount(graph, undefined);
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    let closed = false;
    rerender(
      <Provider store={store}>
        <WorkbenchCanvas graph={graph} onClose={() => { closed = true; }} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(closed).toBe(true);
  });

  it("clicking a node pins its data card into the stash (not a floating popup)", () => {
    const { store, container } = mount();
    const node = container.querySelector('.react-flow__node[data-id="plot"]')!;
    expect(node).toBeTruthy();
    fireEvent.click(node);
    expect(store.get(cardsAtom)).toHaveLength(0); // no floating popup
    const stash = store.get(stashAtom);
    expect(stash).toHaveLength(1);
    expect(stash[0]).toMatchObject({ cardKind: "plot", target: { kind: "node", id: "plot", facet: "plot" } });
  });

  // React Flow does not render any `.react-flow__edge` DOM under jsdom (edges
  // need measured handle positions the headless DOM never supplies — node DOM
  // renders, edge DOM does not), so `fireEvent.click` on an edge is impossible
  // here. The component's `onEdgeClick` wiring is identical to `onNodeClick`
  // (verified by the passing node-click test above) and both route through
  // `targetToCardKind`; we assert that pure resolution rule directly — edge
  // "e0" (a filter) -> the shared op-editor card, "g0" (a geom) -> geom-editor.
  it("edge click resolves to its editor card (e0 filter -> op-editor)", () => {
    expect(targetToCardKind(graph, { kind: "edge", id: "e0" })).toBe("op-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "g0" })).toBe("geom-editor");
    // a stale id resolves to null -> opens nothing.
    expect(targetToCardKind(graph, { kind: "edge", id: "nope" })).toBeNull();
  });

  it("renders an open card from the store as the right card + body", () => {
    const store = createStore();
    store.set(cardsAtom, [{
      id: "node:plot", target: { kind: "node", id: "plot" }, cardKind: "plot",
      x: 30, y: 40, w: 300, h: 200, collapsed: false,
    }]);
    render(<Provider store={store}><WorkbenchCanvas graph={graph} /></Provider>);
    // the dialog's accessible name comes from CARD[cardKind].title ("Plot"),
    // so this distinguishes the plot card from any other kind...
    expect(screen.getByRole("dialog", { name: /plot card/i })).toBeInTheDocument();
    // ...and the PlotCard body (not some other body) actually mounted.
    expect(screen.getByTestId("plot-card")).toBeInTheDocument();
  });

  it("collapse-all collapses every open card", () => {
    const store = createStore();
    store.set(cardsAtom, [{
      id: "node:plot", target: { kind: "node", id: "plot" }, cardKind: "plot",
      x: 0, y: 0, w: 300, h: 200, collapsed: false,
    }]);
    render(<Provider store={store}><WorkbenchCanvas graph={graph} /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(store.get(cardsAtom)[0].collapsed).toBe(true);
  });

  it("re-flows when the graph structure changes (adds a node)", () => {
    const { container, rerender, store } = mount();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    const bigger: ExplorerGraph = {
      nodes: [...graph.nodes,
        { id: "step:1", kind: "table", phase: "reduce", label: "derived", table: { via: "at_step", at_step: 1 } }],
      edges: [...graph.edges,
        { id: "e1", kind: "derive", label: "x = 1", fromId: "step:0", toId: "step:1" }],
      spine: [],
    };
    rerender(<Provider store={store}><WorkbenchCanvas graph={bigger} /></Provider>);
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(4);
  });

  it("tidy clears persisted node positions", () => {
    const store = createStore();
    store.set(nodePositionsAtom, { plot: { x: 999, y: 999 } });
    render(<Provider store={store}><WorkbenchCanvas graph={graph} /></Provider>);
    fireEvent.click(screen.getByRole("button", { name: /tidy/i }));
    expect(store.get(nodePositionsAtom)).toEqual({});
  });

  it("applyNudge records a node's dropped position (immutably)", () => {
    const prev = { source: { x: 1, y: 2 } };
    const next = applyNudge(prev, "plot", 30, 40);
    expect(next).toEqual({ source: { x: 1, y: 2 }, plot: { x: 30, y: 40 } });
    expect(next).not.toBe(prev);          // new object, no mutation
    expect(prev).toEqual({ source: { x: 1, y: 2 } });
  });

  it("toRF places overridden nodes at their nudged position", () => {
    const { nodes } = toRF(graph, { plot: { x: 30, y: 40 } });
    expect(nodes.find(n => n.id === "plot")!.position).toEqual({ x: 30, y: 40 });
    expect(nodes.find(n => n.id === "source")!.position).not.toEqual({ x: 30, y: 40 });
  });

  it("right-clicking the figure node offers Edit plot and Edit test", () => {
    const { store, container } = mount();
    const figureNode = container.querySelector('.react-flow__node[data-id="plot"]')!;
    expect(figureNode).toBeTruthy();
    fireEvent.contextMenu(figureNode);
    expect(screen.getByRole("menuitem", { name: /Edit plot/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Edit test/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /Edit test/i }));
    expect(store.get(cardsAtom)).toMatchObject([{ cardKind: "test-editor" }]);

    // a fresh right-click → "Edit plot…" opens the geom editor.
    fireEvent.contextMenu(figureNode);
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit plot/i }));
    expect(store.get(cardsAtom)).toContainEqual(
      expect.objectContaining({ cardKind: "geom-editor" }));
  });

  it("renders the hero-card row alongside the DAG band", () => {
    const { container } = mount();
    expect(screen.getByTestId("hero-row")).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0);
  });
});
