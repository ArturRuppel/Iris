import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Provider } from "jotai";
import { LayerStrip } from "./LayerStrip";
import { seedStore } from "../workbench/cards/cardTestStore";
import { activePlottableAtom, registryAtom } from "../state";
import type { GeomMeta, Registry } from "../types";

function mount() {
  const { store, plottable } = seedStore();
  const registry: Registry = {
    point_cap: 5000,
    facet_cell_cap: 200,
    geoms: {
      box: {
        label: "Box",
        family: "group_comparison",
        aggregates: true,
        x_type: "categorical",
        y_type: "numeric",
        aes: ["color"],
        needs: [],
        point_cap: null,
      } as GeomMeta,
    },
  };
  store.set(registryAtom, registry);
  store.set(activePlottableAtom, {
    ...plottable,
    mappings: { x: "experiment", y: "val" },
    layers: [{ id: "ly1", geom: "box", level: "" }],
  });
  render(
    <Provider store={store}>
      <LayerStrip addSlot={<button>+ add layer</button>} />
    </Provider>,
  );
  return store;
}

describe("LayerStrip", () => {
  it("renders one row per layer and the add slot", () => {
    mount();
    expect(screen.getByTitle(/change plot type/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add layer/i })).toBeInTheDocument();
  });
  it("removes a layer via the ✕ control", () => {
    const store = mount();
    fireEvent.click(screen.getByTitle(/remove layer/i));
    expect(store.get(activePlottableAtom)?.layers).toHaveLength(0);
  });
});
