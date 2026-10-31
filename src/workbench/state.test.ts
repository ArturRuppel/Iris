import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  selectedTargetAtom, nodePositionsAtom,
  openCardAtom, clearWorkbenchAtom,
  stashAtom, pushStashAtom, popStashAtom, seedDefaultStashAtom, STASH_SLOTS,
  focusedStashIdAtom, displayCollapsedAtom, displayFocusAtom,
} from "./state";
import type { Target } from "./cardRegistry";

const tNode = (id: string): Target => ({ kind: "node", id });

describe("workbench state", () => {
  it("the geom editor shows the Plot card in the display panel, focused on Encoding", () => {
    const s = createStore();
    s.set(openCardAtom, { target: { kind: "edge", id: "g0" }, cardKind: "geom-editor" as const });
    expect(s.get(stashAtom)).toMatchObject([{ cardKind: "plot", target: { kind: "node", id: "figure", facet: "plot" } }]);
    expect(s.get(displayFocusAtom)).toMatchObject({ section: "encoding", n: 1 });
    s.set(openCardAtom, { target: { kind: "edge", id: "g0" }, cardKind: "geom-editor" as const });
    expect(s.get(displayFocusAtom)?.n).toBe(2);   // a repeat click scrolls again
  });

  it("the test editor shows the Stats card, focused on its test picker", () => {
    const s = createStore();
    s.set(openCardAtom, { target: { kind: "edge", id: "t0" }, cardKind: "test-editor" as const });
    expect(s.get(stashAtom)).toMatchObject([{ cardKind: "stats", target: { kind: "node", id: "figure", facet: "stats" } }]);
    expect(s.get(displayFocusAtom)?.section).toBe("test");
  });

  it("a step editor is the display panel's card, replacing the shown one, and selects its edge", () => {
    const s = createStore();
    s.set(seedDefaultStashAtom);
    const edge: Target = { kind: "edge", id: "e0" };
    s.set(openCardAtom, { target: edge, cardKind: "op-editor" as const });
    expect(s.get(stashAtom)).toMatchObject([{ cardKind: "op-editor", target: edge }]);
    expect(s.get(selectedTargetAtom)).toEqual(edge);
    s.set(openCardAtom, { target: { kind: "edge", id: "c0" }, cardKind: "collapse-editor" as const });
    expect(s.get(stashAtom)).toMatchObject([{ cardKind: "collapse-editor" }]);
  });

  it("opening an editor un-hides a collapsed display panel", () => {
    const s = createStore();
    s.set(displayCollapsedAtom, true);
    s.set(openCardAtom, { target: { kind: "edge", id: "e0" }, cardKind: "op-editor" as const });
    expect(s.get(displayCollapsedAtom)).toBe(false);
  });

  it("clearWorkbench resets stash, selection, and node positions", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("plot"), cardKind: "plot" as const });
    s.set(nodePositionsAtom, { source: { x: 10, y: 20 } });
    s.set(clearWorkbenchAtom);
    expect(s.get(stashAtom)).toHaveLength(0);
    expect(s.get(selectedTargetAtom)).toBeNull();
    expect(s.get(nodePositionsAtom)).toEqual({});
  });
});

describe("pop stash", () => {
  it("pushStash pins a card and selects its target", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("source"), cardKind: "table" as const });
    expect(s.get(stashAtom)).toHaveLength(1);
    expect(s.get(stashAtom)[0].cardKind).toBe("table");
    expect(s.get(selectedTargetAtom)).toEqual(tNode("source"));
  });

  it("pushStash is idempotent per target (no duplicate, re-selects)", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(selectedTargetAtom, null);
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["a"]);
    expect(s.get(selectedTargetAtom)).toEqual(tNode("a"));
  });

  it("showing another card replaces the one shown", () => {
    const s = createStore();
    for (const id of ["a", "b", "c"]) {
      s.set(pushStashAtom, { target: tNode(id), cardKind: "table" as const });
    }
    expect(s.get(stashAtom)).toHaveLength(STASH_SLOTS);
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["c"]);
  });

  it("showing a card opens a collapsed display", () => {
    const s = createStore();
    s.set(displayCollapsedAtom, true);
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    expect(s.get(displayCollapsedAtom)).toBe(false);
  });

  it("clears focus when the focused card is replaced", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(focusedStashIdAtom, s.get(stashAtom)[0].id);
    s.set(pushStashAtom, { target: tNode("b"), cardKind: "table" as const });
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["b"]);
    expect(s.get(focusedStashIdAtom)).toBeNull();
  });

  it("popStash removes the shown card by id", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(popStashAtom, s.get(stashAtom)[0].id);
    expect(s.get(stashAtom)).toEqual([]);
  });

  it("seedDefaultStash lands on the figure's plot", () => {
    const s = createStore();
    s.set(seedDefaultStashAtom);
    expect(s.get(stashAtom)).toEqual([
      { id: "node:figure:plot", target: { kind: "node", id: "figure", facet: "plot" }, cardKind: "plot" },
    ]);
  });
});
