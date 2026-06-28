import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { Stash } from "./Stash";
import { stashAtom, selectedTargetAtom, STASH_SLOTS, type StashEntry } from "./state";
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
  it("renders nothing when the stash is empty", () => {
    const { container } = mount([]);
    expect(container.querySelector(".txw-stash")).toBeNull();
  });

  it("shows a pinned card with the node's friendly label, plus ghost slots", () => {
    const { container } = mount([entry("figure", "plot", "plot")]);
    expect(screen.getByTestId("plot-card")).toBeInTheDocument();
    // the slot header shows the node's friendly label, not its raw id
    expect(container.querySelector(".txw-slot-sub")!.textContent).toBe("Figure");
    // one real slot + the rest as ghosts = STASH_SLOTS total
    expect(container.querySelectorAll(".txw-slot")).toHaveLength(STASH_SLOTS);
    expect(container.querySelectorAll(".txw-slot.ghost")).toHaveLength(STASH_SLOTS - 1);
  });

  it("no ghost slots once full", () => {
    const { container } = mount([
      entry("source", "table"), entry("figure", "plot", "plot"), entry("figure", "stats", "stats"),
    ]);
    expect(container.querySelectorAll(".txw-slot")).toHaveLength(STASH_SLOTS);
    expect(container.querySelectorAll(".txw-slot.ghost")).toHaveLength(0);
  });

  it("unpin removes that card from the stash", () => {
    const { store } = mount([entry("figure", "plot", "plot"), entry("source", "table")]);
    const plotSlot = screen.getByRole("group", { name: /Plot: Figure/i });
    fireEvent.click(within(plotSlot).getByRole("button", { name: /unpin/i }));
    expect(store.get(stashAtom).map((e) => e.target.id)).toEqual(["source"]);
  });

  it("pointer-down on a slot selects its target", () => {
    const { store } = mount([entry("figure", "plot", "plot")]);
    fireEvent.pointerDown(screen.getByRole("group", { name: /Plot: Figure/i }));
    expect(store.get(selectedTargetAtom)).toEqual({ kind: "node", id: "figure", facet: "plot" });
  });
});
