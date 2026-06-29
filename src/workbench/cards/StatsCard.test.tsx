import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { StatsCard } from "./StatsCard";
import { seedStore } from "./cardTestStore";
import { activePlottableAtom, registryAtom } from "../../state";
import type { Registry } from "../../types";

const target = { kind: "node" as const, id: "figure", facet: "stats" as const };

function mount(opts: { withPlot: boolean }) {
  const { store, plottable } = seedStore();
  const registry: Registry = { point_cap: 5000, facet_cell_cap: 200, geoms: {
    box: { label: "Box", aggregates: true, x_type: "categorical", y_type: "numeric", aes: ["color"] } as never,
  } };
  store.set(registryAtom, registry);
  store.set(activePlottableAtom, opts.withPlot
    ? { ...plottable, mappings: { x: "experiment", y: "val" }, layers: [{ id: "ly1", geom: "box", level: "" }] }
    : { ...plottable, mappings: { x: "", y: "" }, layers: [] });
  render(<Provider store={store}><StatsCard target={target} /></Provider>);
  return store;
}

describe("StatsCard", () => {
  it("with no plot, shows the 'add a plot first' stub", () => {
    mount({ withPlot: false });
    expect(screen.getByText(/add a plot to see a test/i)).toBeInTheDocument();
  });

  it("with a plot, the stub is gone (results + test picker render)", () => {
    mount({ withPlot: true });
    expect(screen.queryByText(/add a plot to see a test/i)).not.toBeInTheDocument();
  });
});
