import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { HeroCards } from "./HeroCards";
import { seedStore } from "./cards/cardTestStore";
import { activePlottableAtom, registryAtom } from "../state";
import type { ExplorerGraph } from "../explorer/graph";
import type { Registry } from "../types";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "plot", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" } },
  ],
  edges: [], spine: [],
} as unknown as ExplorerGraph;

function mount(opts: { withPlot: boolean }) {
  const { store, plottable } = seedStore();
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", aggregates: true, x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  store.set(activePlottableAtom, opts.withPlot
    ? { ...plottable, mappings: { x: "experiment", y: "val" }, layers: [{ id: "ly1", geom: "box", level: "" }] }
    : { ...plottable, mappings: { x: "", y: "" }, layers: [] });
  render(<Provider store={store}><HeroCards graph={graph} /></Provider>);
  return store;
}

describe("HeroCards", () => {
  it("Table is always present", () => {
    mount({ withPlot: false });
    expect(screen.getByTestId("table-card")).toBeInTheDocument();
  });
  it("with no plot, Plot shows the add-plot CTA and Stats is disabled", () => {
    mount({ withPlot: false });
    expect(screen.getByRole("button", { name: /add plot/i })).toBeInTheDocument();
    expect(screen.getByTestId("hero-stats")).toHaveClass("txw-card-disabled");
  });
  it("with a plot, the Plot body and the layer strip render", () => {
    mount({ withPlot: true });
    expect(screen.getByTestId("layer-strip")).toBeInTheDocument();
    expect(screen.getByTestId("hero-stats")).not.toHaveClass("txw-card-disabled");
  });
});
