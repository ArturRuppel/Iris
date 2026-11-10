import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Provider } from "jotai";
import { StashFocus } from "./Stash";
import { seedStore } from "./cards/cardTestStore";
import { stashAtom, pushStashAtom, openCardAtom, focusedStashIdAtom } from "./state";
import type { ExplorerGraph } from "../explorer/graph";

const graph: ExplorerGraph = {
  nodes: [
    { id: "source", kind: "table", phase: "source", label: "Source", table: { via: "at_step", at_step: -1 } },
    { id: "figure", kind: "figure", phase: "terminal", label: "Figure", table: { via: "none" },
      sections: [{ kind: "plot", facts: ["dots"] }, { kind: "stats", facts: [] }] },
  ],
  edges: [
    { id: "e0", kind: "filter", label: "mask", fromId: "source", toId: "figure" },
    { id: "g0", kind: "geom", label: "dots", fromId: "source", toId: "figure" },
  ],
  spine: [],
};

function mount() {
  const { store } = seedStore();
  const utils = render(<Provider store={store}><StashFocus graph={graph} /></Provider>);
  return { store, ...utils };
}

describe("StashFocus", () => {
  it("renders nothing while no card is open, even with one in the stash", () => {
    const { store, container } = mount();
    act(() => {
      store.set(pushStashAtom, { target: { kind: "node", id: "source" }, cardKind: "table" });
      store.set(focusedStashIdAtom, null);
    });
    expect(store.get(stashAtom)).toHaveLength(1);
    expect(container.querySelector(".txw-focus")).toBeNull();
  });

  it("a step's editor opens as a sheet over a scrim, with Done", () => {
    const { store, container } = mount();
    act(() => { store.set(openCardAtom, { target: { kind: "edge", id: "e0" }, cardKind: "op-editor" }); });
    const focus = container.querySelector(".txw-focus")!;
    expect(focus).toBeTruthy();
    expect(focus.classList.contains("sheet")).toBe(true);
    expect(focus.classList.contains("k-op-editor")).toBe(true);
    expect(container.querySelector(".txw-sheet-scrim")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exit focus" }).textContent).toBe("Done");
    expect(screen.getByText("mask")).toBeInTheDocument();      // the step as subtitle
  });

  it("clicking the scrim closes the sheet", () => {
    const { store, container } = mount();
    act(() => { store.set(openCardAtom, { target: { kind: "edge", id: "e0" }, cardKind: "op-editor" }); });
    fireEvent.click(container.querySelector(".txw-sheet-scrim")!);
    expect(store.get(focusedStashIdAtom)).toBeNull();
    expect(container.querySelector(".txw-focus")).toBeNull();
    expect(container.querySelector(".txw-sheet-scrim")).toBeNull();
  });

  it("a table card opens full-screen, without a scrim, with ‹ Back", () => {
    const { store, container } = mount();
    act(() => { store.set(pushStashAtom, { target: { kind: "node", id: "source" }, cardKind: "table" }); });
    const focus = container.querySelector(".txw-focus")!;
    expect(focus).toBeTruthy();
    expect(focus.classList.contains("sheet")).toBe(false);
    expect(container.querySelector(".txw-sheet-scrim")).toBeNull();
    expect(screen.getByTestId("table-card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit focus" }).textContent).toBe("‹ Back");
  });

  it("the plot card opens full-screen; ‹ Back closes it and keeps it in the stash", () => {
    const { store, container } = mount();
    act(() => { store.set(openCardAtom, { target: { kind: "edge", id: "g0" }, cardKind: "geom-editor" }); });
    const focus = container.querySelector(".txw-focus")!;
    expect(focus.classList.contains("k-plot")).toBe(true);
    expect(focus.classList.contains("sheet")).toBe(false);
    expect(focus.contains(screen.getByTestId("plot-card"))).toBe(true);
    const exit = screen.getByRole("button", { name: "Exit focus" });
    expect(exit.textContent).toBe("‹ Back");
    fireEvent.click(exit);
    expect(store.get(focusedStashIdAtom)).toBeNull();
    expect(container.querySelector(".txw-focus")).toBeNull();
    expect(store.get(stashAtom).map((e) => e.cardKind)).toEqual(["plot"]);
  });
});
