import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { PlotWizard } from "./PlotWizard";
import { seedStore } from "../workbench/cards/cardTestStore";
import { activePlottableAtom, registryAtom } from "../state";
import type { Registry } from "../types";

/* seedWithGeoms seeds a store that makes exactly ONE geom satisfiable:
   - "box" needs 1 usable categorical + 1 numeric → satisfied by cond + val
   - "scatter" needs 2 numerics → only 1 numeric (val) → NOT satisfied
   cond has 2 levels so categoryUsable passes. */
function seedWithGeoms() {
  const { store, plottable } = seedStore(
    ["experiment", "cell"],
    [{ name: "cond", type: "categorical" as const, label: "Condition", levels: ["A", "B"] }],
  );
  const registry: Registry = {
    point_cap: 5000,
    facet_cell_cap: 200,
    geoms: {
      box: {
        label: "Box", aggregates: true,
        x_type: "categorical", y_type: "numeric", aes: ["color"],
      } as never,
      scatter: {
        label: "Scatter", aggregates: false,
        x_type: "numeric", y_type: "numeric", aes: ["color"],
      } as never,
    },
  };
  store.set(registryAtom, registry);
  store.set(activePlottableAtom, { ...plottable, mappings: { x: "", y: "" }, layers: [] });
  return store;
}

describe("PlotWizard (first mode)", () => {
  it("shows only geoms the data can satisfy, then adds the picked layer", () => {
    const store = seedWithGeoms();
    render(
      <Provider store={store}>
        <PlotWizard mode="first" onDone={() => {}} onCancel={() => {}} />
      </Provider>,
    );

    // gallery filter: box is satisfiable, scatter is not
    expect(screen.getByRole("button", { name: /^Box$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Scatter$/ })).toBeNull();

    // clicking Box appends a layer and advances to the map step
    fireEvent.click(screen.getByRole("button", { name: /^Box$/ }));
    expect(store.get(activePlottableAtom)?.layers).toHaveLength(1);

    // map step shows EncodingsCard — it renders the "X" enc-label span
    expect(screen.getByText("X")).toBeInTheDocument();
  });

  it("cancel fires onCancel", () => {
    const store = seedWithGeoms();
    const onCancel = vi.fn();
    render(
      <Provider store={store}>
        <PlotWizard mode="first" onDone={() => {}} onCancel={onCancel} />
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
