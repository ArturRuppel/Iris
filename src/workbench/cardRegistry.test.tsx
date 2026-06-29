import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { targetToCardKind, CARD, type CardKind } from "./cardRegistry";
import { seedStore } from "./cards/cardTestStore";
import { setAnalysisByIdAtom, activePlottableAtom, registryAtom } from "../state";
import type { Registry } from "../types";
import type { ExplorerGraph } from "../explorer/graph";
import type { AnalyzeResponse } from "../types";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" },
      sections: [{ kind: "plot", facts: ["dots"] }, { kind: "stats", facts: ["MW"] }] },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "figure" },
    { id: "c0", kind: "collapse", label: "mean", fromId: "source", toId: "figure" },
    { id: "g0", kind: "geom", label: "dots", fromId: "source", toId: "figure" },
    { id: "t0", kind: "test", label: "MW", fromId: "source", toId: "figure" },
  ],
  spine: [],
};

describe("targetToCardKind", () => {
  it("maps a table node to table and the figure facets to plot/stats", () => {
    expect(targetToCardKind(graph, { kind: "node", id: "source" })).toBe("table");
    expect(targetToCardKind(graph, { kind: "node", id: "figure", facet: "plot" })).toBe("plot");
    expect(targetToCardKind(graph, { kind: "node", id: "figure", facet: "stats" })).toBe("stats");
    expect(targetToCardKind(graph, { kind: "node", id: "figure" })).toBe("plot");
  });

  it("maps each edge kind to its editor card", () => {
    expect(targetToCardKind(graph, { kind: "edge", id: "e0" })).toBe("op-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "c0" })).toBe("collapse-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "g0" })).toBe("geom-editor");
    expect(targetToCardKind(graph, { kind: "edge", id: "t0" })).toBe("test-editor");
  });

  it("returns null for an id that is not in the graph", () => {
    expect(targetToCardKind(graph, { kind: "node", id: "nope" })).toBeNull();
    expect(targetToCardKind(graph, { kind: "edge", id: "nope" })).toBeNull();
  });
});

describe("CARD registry", () => {
  const kinds: CardKind[] = ["table", "plot", "stats", "op-editor",
    "collapse-editor", "geom-editor", "test-editor"];

  it("has a non-empty title and a body component for every card kind", () => {
    for (const k of kinds) {
      expect(CARD[k].title).toBeTruthy();
      expect(CARD[k].body).toBeTypeOf("function");
    }
  });
});

/* A partial AnalyzeResponse rich enough for the results (StatsResults) and the
   picker (TestPicker) to render — only the fields those components read. */
const fixture = {
  stats: {
    result: {
      test: "welch_t", t: 2.5, df: 18.3, p: 0.022,
      mean_diff: 1.4, mean_diff_ci: [0.2, 2.6],
      effect: { name: "hedges_g", value: 0.8, ci: [0.1, 1.5] },
    },
    recommendation: { test: "welch_t", reason: "two independent numeric groups" },
    checks: [], summaries: [], decision: null, alpha: 0.05,
    methods_text: "Welch's t-test was used to compare the two groups.",
  },
  stat_model: {
    design: "Two independent groups", issues: [],
    family: "group_comparison", pairing: null, chosen_by: "inferred",
  },
} as unknown as AnalyzeResponse;

/* render a card body straight from the registry; the bodies ignore the target,
   so any target works. withResult seeds an analysis for the terminals; renderable
   maps X/Y + a layer so the gated plot/stats bodies show their panels rather than
   the add-plot CTA / "add a plot first" stub. */
function renderBody(kind: CardKind, withResult = false, renderable = false) {
  const { store, plottable } = seedStore();
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", aggregates: true, x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  if (renderable) store.set(activePlottableAtom,
    { ...plottable, mappings: { x: "experiment", y: "val" }, layers: [{ id: "ly1", geom: "box", level: "" }] });
  if (withResult) store.set(setAnalysisByIdAtom, { id: plottable.id, res: fixture });
  const Body = CARD[kind].body;
  return render(<Provider store={store}><Body target={{ kind: "edge", id: "x" }} /></Provider>);
}

describe("card bodies — each renders its panel inside the classed wrapper", () => {
  it("plot mounts the FigurePane when the spec is renderable", () => {
    const { container } = renderBody("plot", false, true);
    expect(container.querySelector('[data-testid="plot-card"]')).toBeInTheDocument();
    expect(container.querySelector(".figure-pane")).toBeInTheDocument();
  });

  it("collapse mounts the routing panel", () => {
    const { container } = renderBody("collapse-editor");
    expect(container.querySelector('[data-testid="collapse-card"]')).toBeInTheDocument();
    expect(screen.getByLabelText(/test reads at/i)).toBeInTheDocument();
  });

  it("geom mounts the encoding + layer editors", () => {
    const { container } = renderBody("geom-editor");
    const wrap = container.querySelector('[data-testid="geom-card"]');
    expect(wrap).toBeInTheDocument();
    expect(wrap!.children.length).toBeGreaterThan(0);
  });

  // the stats landing card shows BOTH halves of the StatsPanel module — the
  // results readout plus the test picker (the test-editor card, by contrast,
  // mounts only the picker; asserted below by the absence of the readout).
  it("stats shows the results readout and the test picker", () => {
    const { container } = renderBody("stats", true, true);
    expect(container.querySelector('[data-testid="stats-card"]')).toBeInTheDocument();
    expect(screen.getByText(/Methods text/i)).toBeInTheDocument();          // results readout
    expect(screen.getByText(/significance brackets/i)).toBeInTheDocument(); // test picker
  });

  it("test shows the picker, not the results readout", () => {
    const { container } = renderBody("test-editor", true);
    expect(container.querySelector('[data-testid="test-card"]')).toBeInTheDocument();
    expect(screen.getByText(/Describe only/i)).toBeInTheDocument();
    expect(screen.queryByText(/Methods text/i)).toBeNull();
    expect(screen.getByText(/significance brackets/i)).toBeInTheDocument();
  });

  // restores the interaction coverage lost with AnnotateCard: the folded-in
  // toggle must actually write style.show_significance on the active plottable.
  it("toggling the significance checkbox writes style.show_significance", () => {
    const { store, plottable } = seedStore();
    store.set(setAnalysisByIdAtom, { id: plottable.id, res: fixture });
    const Body = CARD["test-editor"].body;
    render(<Provider store={store}><Body target={{ kind: "edge", id: "x" }} /></Provider>);
    const box = screen.getByRole("checkbox", { name: /significance brackets/i });
    expect(store.get(activePlottableAtom)?.style.show_significance).toBeFalsy();
    fireEvent.click(box);
    expect(store.get(activePlottableAtom)?.style.show_significance).toBe(true);
  });
});
