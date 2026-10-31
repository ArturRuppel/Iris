import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { Stash } from "./Stash";
import { stashAtom, selectedTargetAtom, displayCollapsedAtom, type StashEntry } from "./state";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Raw cells", table: { via: "at_step", at_step: -1 } },
    { id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" } },
  ],
  edges: [],
  spine: [],
};

const entry = (id: string, cardKind: StashEntry["cardKind"], facet?: "plot" | "stats"): StashEntry => ({
  id: facet ? `node:${id}:${facet}` : `node:${id}`,
  target: facet ? { kind: "node", id, facet } : { kind: "node", id },
  cardKind,
});

function mount(entries: StashEntry[]) {
  const store = createStore();
  store.set(stashAtom, entries);
  const utils = render(<Provider store={store}><Stash graph={graph} /></Provider>);
  return { store, ...utils };
}

describe("Stash", () => {
  it("shows a hint when nothing is shown", () => {
    const { container } = mount([]);
    expect(container.querySelector(".txw-slot")).toBeNull();
    expect(screen.getByText(/Click a table/)).toBeInTheDocument();
  });

  it("shows the card with the node's friendly label", () => {
    const { container } = mount([entry("figure", "plot", "plot")]);
    expect(screen.getByTestId("plot-card")).toBeInTheDocument();
    expect(container.querySelector(".txw-slot-sub")!.textContent).toBe("Figure");
    expect(container.querySelectorAll(".txw-slot")).toHaveLength(1);
  });

  it("collapses to a rail and comes back with the same card", () => {
    const { store } = mount([entry("figure", "plot", "plot")]);
    fireEvent.click(within(screen.getByRole("group", { name: /Plot: Figure/i })).getByRole("button", { name: /hide display/i }));
    expect(store.get(displayCollapsedAtom)).toBe(true);
    expect(screen.queryByTestId("plot-card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Display/ }));
    expect(screen.getByTestId("plot-card")).toBeInTheDocument();
    expect(store.get(stashAtom)).toHaveLength(1);
  });

  it("pointer-down on a slot selects its target", () => {
    const { store } = mount([entry("figure", "plot", "plot")]);
    fireEvent.pointerDown(screen.getByRole("group", { name: /Plot: Figure/i }));
    expect(store.get(selectedTargetAtom)).toEqual({ kind: "node", id: "figure", facet: "plot" });
  });
});
