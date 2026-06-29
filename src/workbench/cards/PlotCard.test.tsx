import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { PlotCard } from "./PlotCard";
import { seedStore } from "./cardTestStore";
import { activePlottableAtom, registryAtom } from "../../state";
import type { Registry } from "../../types";

const target = { kind: "node" as const, id: "figure", facet: "plot" as const };

function mount(opts: { withPlot: boolean }) {
  const { store, plottable } = seedStore();
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", aggregates: true, x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  store.set(activePlottableAtom, opts.withPlot
    ? { ...plottable, mappings: { x: "experiment", y: "val" }, layers: [{ id: "ly1", geom: "box", level: "" }] }
    : { ...plottable, mappings: { x: "", y: "" }, layers: [] });
  render(<Provider store={store}><PlotCard target={target} /></Provider>);
  return store;
}

describe("PlotCard", () => {
  it("with no renderable plot, shows the add-plot CTA", () => {
    mount({ withPlot: false });
    expect(screen.getByRole("button", { name: /add plot/i })).toBeInTheDocument();
  });

  it("with a plot, renders the figure body and the layer strip", () => {
    mount({ withPlot: true });
    expect(screen.getByTestId("layer-strip")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add plot/i })).not.toBeInTheDocument();
  });
});
