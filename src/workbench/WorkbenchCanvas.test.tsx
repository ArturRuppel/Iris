import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { WorkbenchCanvas, applyNudge, onConnectDelegate, frameViewport, MIN_READABLE_ZOOM } from "./WorkbenchCanvas";
import { nodePositionsAtom, stashAtom, seedDefaultStashAtom, focusedStashIdAtom } from "./state";
import { toRFLanes, headId, ADD_LANE_ID, type Lane } from "./lanes";
import { targetToCardKind } from "./cardRegistry";
import { activePlottableIdAtom } from "../state";
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

/* the test's graph as the one (active) analysis on the canvas */
const lanesOf = (g: ExplorerGraph): Lane[] => [{
  id: "p1", name: "Analysis 1", tag: "", marks: "Dots", active: true,
  tableName: "Source", statsOff: false, graph: g, svg: null,
}];

function mount(g: ExplorerGraph = graph) {
  const store = createStore();
  const utils = render(
    <Provider store={store}><WorkbenchCanvas graph={g} lanes={lanesOf(g)} /></Provider>,
  );
  return { store, ...utils };
}

describe("onConnectDelegate", () => {
  // stand-in resolver: source -> "src", step:i -> "n<i>", everything else unwireable.
  const dagIdOf = (g: string): string | null =>
    g === "source" ? "src" : /^step:(\d+)$/.test(g) ? `n${g.slice(5)}` : null;

  it("maps a drop on a join's right handle to slot 1", () => {
    const arg = onConnectDelegate({ source: "step:0", target: "step:1", targetHandle: "in-1" }, dagIdOf);
    expect(arg).toEqual({ targetId: "n1", sourceId: "n0", slot: 1 });
  });

  it("maps a drop on the primary handle to slot 0", () => {
    const arg = onConnectDelegate({ source: "source", target: "step:0", targetHandle: "in" }, dagIdOf);
    expect(arg).toEqual({ targetId: "n0", sourceId: "src", slot: 0 });
  });

  it("drops a connection to/from an unwireable (synthetic/terminal) node", () => {
    expect(onConnectDelegate({ source: "source:0", target: "step:0", targetHandle: "in-1" }, dagIdOf)).toBeNull();
    expect(onConnectDelegate({ source: "step:0", target: "figure", targetHandle: "in" }, dagIdOf)).toBeNull();
    expect(onConnectDelegate({ source: null, target: "step:0", targetHandle: "in" }, dagIdOf)).toBeNull();
  });
});

describe("WorkbenchCanvas", () => {
  it("renders one React Flow node per graph node, a lane header and the add-lane node, plus a tidy control", () => {
    const { container } = mount();
    expect(screen.getByRole("button", { name: /tidy/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".react-flow__node-arrayShape")).toHaveLength(3);
    expect(container.querySelector(`.react-flow__node[data-id="${headId("p1")}"]`)).toBeTruthy();
    expect(container.querySelector(`.react-flow__node[data-id="${ADD_LANE_ID}"]`)).toBeTruthy();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(5);
  });

  it("puts undo, redo and tidy in the canvas control cluster", () => {
    const { container } = mount();
    const controls = container.querySelector(".react-flow__controls")!;
    expect(controls).toBeTruthy();
    for (const name of ["Undo", "Redo", "Tidy"]) {
      const b = screen.getByRole("button", { name });
      expect(controls.contains(b)).toBe(true);
      expect(b.getAttribute("title")).toBeTruthy();
    }
    expect(container.querySelector(".txw-topbar")).toBeNull();
    expect(container.querySelector(".txw-card")).toBeNull();   // nothing floats
    // nothing in history yet: undo/redo start disabled
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("clicking a node shows its data card and opens it over the canvas", () => {
    const { store, container } = mount();
    const node = container.querySelector('.react-flow__node[data-id="plot"]')!;
    expect(node).toBeTruthy();
    fireEvent.click(node);
    const stash = store.get(stashAtom);
    expect(stash).toHaveLength(1);
    expect(stash[0]).toMatchObject({ cardKind: "plot", target: { kind: "node", id: "plot", facet: "plot" } });
    expect(store.get(focusedStashIdAtom)).toBe(stash[0].id);
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

  it("re-flows when the graph structure changes (adds a node)", () => {
    const { container, rerender, store } = mount();
    expect(container.querySelectorAll(".react-flow__node-arrayShape")).toHaveLength(3);
    const bigger: ExplorerGraph = {
      nodes: [...graph.nodes,
        { id: "step:1", kind: "table", phase: "reduce", label: "derived", table: { via: "at_step", at_step: 1 } }],
      edges: [...graph.edges,
        { id: "e1", kind: "derive", label: "x = 1", fromId: "step:0", toId: "step:1" }],
      spine: [],
    };
    rerender(<Provider store={store}><WorkbenchCanvas graph={bigger} lanes={lanesOf(bigger)} /></Provider>);
    expect(container.querySelectorAll(".react-flow__node-arrayShape")).toHaveLength(4);
  });

  it("tidy clears persisted node positions", () => {
    const store = createStore();
    store.set(nodePositionsAtom, { plot: { x: 999, y: 999 } });
    render(<Provider store={store}><WorkbenchCanvas graph={graph} lanes={lanesOf(graph)} /></Provider>);
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

  it("toRFLanes places overridden nodes of the active lane at their nudged position", () => {
    const { nodes } = toRFLanes(lanesOf(graph), { plot: { x: 30, y: 40 } });
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
    expect(store.get(stashAtom)).toMatchObject([{ cardKind: "stats", target: { id: "figure", facet: "stats" } }]);

    // a fresh right-click → "Edit plot…" shows the Plot card (its encoding
    // section), not a separate geom editor.
    fireEvent.contextMenu(figureNode);
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit plot/i }));
    expect(store.get(stashAtom)).toMatchObject([{ cardKind: "plot", target: { id: "figure", facet: "plot" } }]);
  });

  // an edge is a thin target, so the step's editor is also reachable from the
  // node it produced: the context menu and a double-click both open it.
  it("opens a step's editor from its node: context menu and double-click", () => {
    const { store, container } = mount();
    const stepNode = container.querySelector('.react-flow__node[data-id="step:0"]')!;
    fireEvent.contextMenu(stepNode);
    fireEvent.click(screen.getByRole("menuitem", { name: /Edit step/i }));
    expect(store.get(stashAtom)).toMatchObject([{ cardKind: "op-editor", target: { kind: "edge", id: "e0" } }]);

    store.set(stashAtom, []);
    fireEvent.doubleClick(stepNode);
    expect(store.get(stashAtom)).toMatchObject([{ cardKind: "op-editor", target: { kind: "edge", id: "e0" } }]);
  });

  it("offers no step editor on the source, which no step produced", () => {
    const { container } = mount();
    fireEvent.contextMenu(container.querySelector('.react-flow__node[data-id="source"]')!);
    expect(screen.queryByRole("menuitem", { name: /Edit step/i })).toBeNull();
  });

  it("the seeded plot card stays closed until shown, then opens over the DAG", () => {
    const store = createStore();
    store.set(seedDefaultStashAtom);
    const { container } = render(
      <Provider store={store}><WorkbenchCanvas graph={graph} lanes={lanesOf(graph)} /></Provider>);
    expect(container.querySelector(".txw-focus")).toBeNull();
    fireEvent.click(container.querySelector('.react-flow__node[data-id="plot"]')!);
    const focus = container.querySelector(".txw-focus")!;
    expect(focus).toBeTruthy();
    expect(focus.contains(screen.getByTestId("plot-card"))).toBe(true);
    expect(screen.queryByTestId("table-card")).toBeNull();
    expect(screen.queryByTestId("stats-card")).toBeNull();
    expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0);
  });

  it("clicking a lane header selects its analysis", () => {
    const { store, container } = mount();
    fireEvent.click(container.querySelector(`.react-flow__node[data-id="${headId("p1")}"] .txw-lanehead`)!);
    expect(store.get(activePlottableIdAtom)).toBe("p1");
  });
});

describe("frameViewport", () => {
  const pane = { width: 748, height: 688 };   // 700 x 600 after the padding
  it("centres a graph that fits, at its natural size at most", () => {
    const v = frameViewport({ x: 0, y: 0, width: 400, height: 150 }, pane);
    expect(v.zoom).toBe(1);
    expect(v.x).toBe(24 + (700 - 400) / 2);
    expect(v.y).toBe(24 + (600 - 150) / 2);
  });
  it("shrinks a slightly-too-wide graph to fit, while it stays readable", () => {
    const v = frameViewport({ x: 0, y: 0, width: 875, height: 150 }, pane);
    expect(v.zoom).toBeCloseTo(0.8);
    expect(v.x).toBeCloseTo(24);
  });
  it("never goes below the readable zoom: a long graph starts at its source", () => {
    const v = frameViewport({ x: 0, y: 0, width: 3000, height: 150 }, pane);
    expect(v.zoom).toBe(MIN_READABLE_ZOOM);
    expect(v.x).toBe(24);                                  // left end flush
  });
  it("puts the open node in view on a graph that overflows", () => {
    const bounds = { x: 0, y: 0, width: 3000, height: 150 };
    const last = { x: 2828, y: 0, width: 172, height: 150 };
    const v = frameViewport(bounds, pane, last);
    // the last node cannot be centred without showing empty space past the
    // end, so the right end sits flush instead
    expect(v.x + 3000 * v.zoom).toBeCloseTo(24 + 700);
    const mid = { x: 1400, y: 0, width: 172, height: 150 };
    const m = frameViewport(bounds, pane, mid);
    expect(m.x + (1400 + 86) * m.zoom).toBeCloseTo(24 + 350);   // centred
  });
});
