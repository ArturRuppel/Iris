import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  selectedTargetAtom, nodePositionsAtom,
  openCardAtom, clearWorkbenchAtom,
  stashAtom, pushStashAtom, popStashAtom, seedDefaultStashAtom, STASH_SLOTS,
  focusedStashIdAtom, displayFocusAtom,
} from "./state";
import type { Target } from "./cardRegistry";

const tNode = (id: string): Target => ({ kind: "node", id });

describe("workbench state", () => {
  it("the geom editor shows the Plot card, focused on Encoding", () => {
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

  it("a step editor is the shown card, replacing the one shown, and selects its edge", () => {
    const s = createStore();
    s.set(seedDefaultStashAtom);
    const edge: Target = { kind: "edge", id: "e0" };
    s.set(openCardAtom, { target: edge, cardKind: "op-editor" as const });
    expect(s.get(stashAtom)).toMatchObject([{ cardKind: "op-editor", target: edge }]);
    expect(s.get(selectedTargetAtom)).toEqual(edge);
    s.set(openCardAtom, { target: { kind: "edge", id: "c0" }, cardKind: "collapse-editor" as const });
    expect(s.get(stashAtom)).toMatchObject([{ cardKind: "collapse-editor" }]);
  });

  it("opening an editor opens it over the canvas (focuses its card)", () => {
    const s = createStore();
    s.set(openCardAtom, { target: { kind: "edge", id: "e0" }, cardKind: "op-editor" as const });
    expect(s.get(focusedStashIdAtom)).toBe("edge:e0");
    s.set(openCardAtom, { target: { kind: "edge", id: "g0" }, cardKind: "geom-editor" as const });
    expect(s.get(focusedStashIdAtom)).toBe("node:figure:plot");
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

  it("an analysis switch (clear + reseed) closes an open card", () => {
    const s = createStore();
    s.set(seedDefaultStashAtom);
    const plotId = s.get(stashAtom)[0].id;
    s.set(focusedStashIdAtom, plotId);
    s.set(clearWorkbenchAtom);
    expect(s.get(focusedStashIdAtom)).toBeNull();
    s.set(seedDefaultStashAtom);
    expect(s.get(stashAtom).map((e) => e.id)).toEqual([plotId]);
    expect(s.get(focusedStashIdAtom)).toBeNull();   // reseeding does not reopen it
    // any other open card is closed too
    s.set(pushStashAtom, { target: tNode("x"), cardKind: "table" as const });
    expect(s.get(focusedStashIdAtom)).toBe("node:x");
    s.set(clearWorkbenchAtom);
    expect(s.get(focusedStashIdAtom)).toBeNull();
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

  it("showing a card opens it over the canvas (sets focus)", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    expect(s.get(focusedStashIdAtom)).toBe(s.get(stashAtom)[0].id);
  });

  it("showing a card already in the stash focuses it again (no duplicate)", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(focusedStashIdAtom, null);                 // the user closed it
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    expect(s.get(stashAtom)).toHaveLength(1);
    expect(s.get(focusedStashIdAtom)).toBe("node:a");
  });

  it("replacing the focused card moves focus to the new one (no stale id)", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(pushStashAtom, { target: tNode("b"), cardKind: "table" as const });
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["b"]);
    expect(s.get(focusedStashIdAtom)).toBe("node:b");
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
