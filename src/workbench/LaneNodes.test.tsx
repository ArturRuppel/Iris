import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Provider } from "jotai";
import { LaneHeadNode } from "./LaneNodes";
import type { Lane } from "./lanes";
import { seedStore } from "./cards/cardTestStore";
import {
  plottablesAtom, activePlottableIdAtom, makeDefaultPlottable, styleRegistryAtom,
  styleClipboardAtom, onePlotOnlyAtom,
} from "../state";
import type { ExplorerGraph } from "../explorer/graph";
import type { StyleKnob } from "../types";

const emptyGraph = { nodes: [], edges: [], spine: [] } as unknown as ExplorerGraph;
const laneFor = (id: string, name: string, active = false): Lane => ({
  id, name, tag: "", marks: "", active, tableName: "main", statsOff: false,
  graph: emptyGraph, svg: null,
});

/* a seeded store with `n` analyses (the first active), and the header of the
   analysis at index `at` */
function mountHead(n = 2, at = 1) {
  const { store, plottable } = seedStore();
  const extra = Array.from({ length: n - 1 }, (_, i) =>
    ({ ...makeDefaultPlottable("main"), name: `Analysis ${i + 2}` }));
  store.set(plottablesAtom, [plottable, ...extra]);
  const ps = store.get(plottablesAtom);
  const p = ps[at];
  const utils = render(
    <Provider store={store}><LaneHeadNode data={{ lane: laneFor(p.id, p.name, at === 0) }} /></Provider>);
  return { store, plottables: ps, lane: p, ...utils };
}

const openMenu = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
const items = () => screen.queryAllByRole("menuitem").map((b) => b.textContent);

describe("LaneHeadNode", () => {
  it("clicking the header makes its analysis the active one", () => {
    const { store, lane, container } = mountHead();
    expect(store.get(activePlottableIdAtom)).not.toBe(lane.id);
    fireEvent.click(container.querySelector(".txw-lanehead")!);
    expect(store.get(activePlottableIdAtom)).toBe(lane.id);
  });

  it("the ⋯ menu offers Rename, Duplicate and Delete analysis, and opening it selects nothing", () => {
    const { store, lane, plottables } = mountHead();
    openMenu(lane.name);
    expect(items()).toEqual(expect.arrayContaining(["Rename", "Duplicate", "Copy style", "Delete analysis"]));
    expect(store.get(activePlottableIdAtom)).toBe(plottables[0].id);   // ⋯ stops propagation
  });

  it("offers no Delete when there is only one analysis", () => {
    const { lane } = mountHead(1, 0);
    openMenu(lane.name);
    expect(items()).toContain("Rename");
    expect(items()).not.toContain("Delete analysis");
  });

  it("offers no Duplicate on a one-plot (lab-book) figure", () => {
    const { store, plottable } = seedStore();
    store.set(onePlotOnlyAtom, true);
    render(<Provider store={store}><LaneHeadNode data={{ lane: laneFor(plottable.id, plottable.name, true) }} /></Provider>);
    openMenu(plottable.name);
    expect(items()).not.toContain("Duplicate");
  });

  it("Delete analysis removes it; Duplicate adds a copy", () => {
    const { store, lane } = mountHead(3, 1);
    openMenu(lane.name);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(store.get(plottablesAtom)).toHaveLength(4);
    openMenu(lane.name);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete analysis" }));
    expect(store.get(plottablesAtom).map((p) => p.id)).not.toContain(lane.id);
  });

  it("Rename edits the name in place and commits it on Enter", () => {
    const { store, lane } = mountHead();
    openMenu(lane.name);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByDisplayValue(lane.name);
    fireEvent.change(input, { target: { value: "Speed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(store.get(plottablesAtom).find((p) => p.id === lane.id)!.name).toBe("Speed");
  });

  it("Copy style, then Paste style to all analyses, gives every analysis that style", () => {
    const { store, lane } = mountHead(3, 1);
    const knob: StyleKnob = { key: "font_size", label: "Font size", group: "Text",
      widget: { type: "number" }, default: 10, scope: "figure", transferable: true };
    // inside act, so the header re-renders before the menu reads the store
    act(() => {
      store.set(styleRegistryAtom, [knob]);
      store.set(plottablesAtom, store.get(plottablesAtom).map((p) =>
        p.id === lane.id ? { ...p, style: { ...p.style, font_size: 17 } as typeof p.style } : p));
    });
    openMenu(lane.name);
    expect(items()).not.toContain("Paste style");             // nothing copied yet
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy style" }));
    expect(store.get(styleClipboardAtom)?.style).toMatchObject({ font_size: 17 });
    openMenu(lane.name);
    expect(items()).toContain("Paste style");
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste style to all analyses" }));
    for (const p of store.get(plottablesAtom))
      expect((p.style as Record<string, unknown>).font_size).toBe(17);
  });

  it("typing in the tag input sets the analysis's panel tag", () => {
    const { store, lane } = mountHead();
    fireEvent.change(screen.getByLabelText(`Panel tag of ${lane.name}`), { target: { value: "B" } });
    expect(store.get(plottablesAtom).find((p) => p.id === lane.id)!.tag).toBe("B");
  });
});
