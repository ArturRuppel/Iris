import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { PlotWizard } from "./PlotWizard";
import { seedStore } from "../workbench/cards/cardTestStore";
import { activePlottableAtom, nextLayerId, registryAtom } from "../state";
import type { GeomMeta, Registry } from "../types";

const BOX: GeomMeta = {
  label: "Box", aggregates: true,
  x_type: "categorical", y_type: "numeric", aes: ["color"],
} as unknown as GeomMeta;
const SCATTER: GeomMeta = {
  label: "Scatter", aggregates: false,
  x_type: "numeric", y_type: "numeric", aes: ["color"],
} as unknown as GeomMeta;

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
    point_cap: 5000, facet_cell_cap: 200,
    geoms: { box: BOX, scatter: SCATTER },
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

describe("PlotWizard (addLayer mode)", () => {
  /* a figure that already has X/Y mapped and one renderable layer (length 1), so
     a second layer added through the wizard lands at index 1 and the grain step
     governs that layer. */
  function seedWithExistingLayer() {
    const { store, plottable } = seedStore(
      ["experiment", "cell"],
      [{ name: "cond", type: "categorical" as const, label: "Condition", levels: ["A", "B"] }],
    );
    const registry: Registry = {
      point_cap: 5000, facet_cell_cap: 200,
      geoms: { box: BOX, scatter: SCATTER },
    };
    store.set(registryAtom, registry);
    store.set(activePlottableAtom, {
      ...plottable,
      mappings: { x: "cond", y: "val" },
      layers: [{ id: nextLayerId(), geom: "box", level: "" }],
    });
    return store;
  }

  it("adds a second layer, advances to the grain step, and writes its level", () => {
    const store = seedWithExistingLayer();
    render(
      <Provider store={store}>
        <PlotWizard mode="addLayer" onDone={() => {}} onCancel={() => {}} />
      </Provider>,
    );

    // pick a satisfiable geom → appends layer at index 1, advances to grain
    fireEvent.click(screen.getByRole("button", { name: /^Box$/ }));
    expect(store.get(activePlottableAtom)?.layers).toHaveLength(2);

    // grain step shows the level <select>
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    // changing the grain writes the new level onto the layer at index 1
    fireEvent.change(select, { target: { value: "experiment" } });
    expect(store.get(activePlottableAtom)?.layers[1].level).toBe("experiment");
  });

  it("cancel rolls back the just-added layer", () => {
    const store = seedWithExistingLayer();
    const onCancel = vi.fn();
    render(
      <Provider store={store}>
        <PlotWizard mode="addLayer" onDone={() => {}} onCancel={onCancel} />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Box$/ }));
    expect(store.get(activePlottableAtom)?.layers).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    // the wizard removed the layer it appended → back to the original one
    expect(store.get(activePlottableAtom)?.layers).toHaveLength(1);
  });
});
