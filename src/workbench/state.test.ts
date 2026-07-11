import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  selectedTargetAtom, cardsAtom, nodePositionsAtom,
  openCardAtom, closeCardAtom, moveCardAtom, resizeCardAtom,
  toggleCardCollapsedAtom, collapseAllCardsAtom, clearWorkbenchAtom,
  stashAtom, pushStashAtom, popStashAtom, seedDefaultStashAtom, STASH_SLOTS,
  focusedStashIdAtom, workbenchLayoutAtom, DEFAULT_STASH_H,
} from "./state";
import type { Target } from "./cardRegistry";

const tNode = (id: string): Target => ({ kind: "node", id });

describe("workbench state", () => {
  it("openCard adds a card and selects its target", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    expect(s.get(cardsAtom)).toHaveLength(1);
    expect(s.get(cardsAtom)[0].cardKind).toBe("table");
    expect(s.get(selectedTargetAtom)).toEqual(tNode("source"));
  });

  it("openCard is idempotent per target (no duplicate, re-selects)", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    s.set(openCardAtom, { target: tNode("plot"), cardKind: "plot" as const });
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    expect(s.get(cardsAtom)).toHaveLength(2);
    expect(s.get(selectedTargetAtom)).toEqual(tNode("source"));
  });

  it("closeCard removes the card by id", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    const id = s.get(cardsAtom)[0].id;
    s.set(closeCardAtom, id);
    expect(s.get(cardsAtom)).toHaveLength(0);
  });

  it("moveCard and resizeCard update geometry by id", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    const id = s.get(cardsAtom)[0].id;
    s.set(moveCardAtom, { id, x: 123, y: 45 });
    s.set(resizeCardAtom, { id, w: 500, h: 320 });
    const card = s.get(cardsAtom)[0];
    expect([card.x, card.y, card.w, card.h]).toEqual([123, 45, 500, 320]);
  });

  it("toggleCardCollapsed flips one card; collapseAll collapses every card", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(openCardAtom, { target: tNode("b"), cardKind: "table" as const });
    const idA = s.get(cardsAtom)[0].id;
    s.set(toggleCardCollapsedAtom, idA);
    expect(s.get(cardsAtom)[0].collapsed).toBe(true);
    expect(s.get(cardsAtom)[1].collapsed).toBe(false);
    s.set(collapseAllCardsAtom);
    expect(s.get(cardsAtom).every((c) => c.collapsed)).toBe(true);
  });

  it("clearWorkbench resets cards, stash, selection, node positions, and layout", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    s.set(pushStashAtom, { target: tNode("plot"), cardKind: "plot" as const });
    s.set(nodePositionsAtom, { source: { x: 10, y: 20 } });
    s.set(workbenchLayoutAtom, { stashH: 999, cols: [3, 1, 2] });
    s.set(clearWorkbenchAtom);
    expect(s.get(cardsAtom)).toHaveLength(0);
    expect(s.get(stashAtom)).toHaveLength(0);
    expect(s.get(selectedTargetAtom)).toBeNull();
    expect(s.get(nodePositionsAtom)).toEqual({});
    expect(s.get(workbenchLayoutAtom)).toEqual({
      stashH: DEFAULT_STASH_H, cols: Array(STASH_SLOTS).fill(1),
    });
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

  it("pushStash is idempotent per target (no duplicate, no reorder, re-selects)", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(pushStashAtom, { target: tNode("b"), cardKind: "table" as const });
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["a", "b"]);
    expect(s.get(selectedTargetAtom)).toEqual(tNode("a"));
  });

  it("evicts the oldest when a 4th distinct card is pinned (FIFO ring)", () => {
    const s = createStore();
    for (const id of ["a", "b", "c", "d"]) {
      s.set(pushStashAtom, { target: tNode(id), cardKind: "table" as const });
    }
    expect(s.get(stashAtom)).toHaveLength(STASH_SLOTS);
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["b", "c", "d"]);
  });

  it("clears focus when the FIFO evicts the focused tile", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(focusedStashIdAtom, s.get(stashAtom)[0].id);   // focus the oldest
    for (const id of ["b", "c", "d"]) {
      s.set(pushStashAtom, { target: tNode(id), cardKind: "table" as const });
    }
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["b", "c", "d"]);
    expect(s.get(focusedStashIdAtom)).toBeNull();        // "a" gone → focus reset
  });

  it("popStash unpins one card by id", () => {
    const s = createStore();
    s.set(pushStashAtom, { target: tNode("a"), cardKind: "table" as const });
    s.set(pushStashAtom, { target: tNode("b"), cardKind: "table" as const });
    s.set(popStashAtom, s.get(stashAtom)[0].id);
    expect(s.get(stashAtom).map((e) => e.target.id)).toEqual(["b"]);
  });

  it("seedDefaultStash fills the trio: source table, figure plot, figure stats", () => {
    const s = createStore();
    s.set(seedDefaultStashAtom);
    expect(s.get(stashAtom)).toEqual([
      { id: "node:source", target: { kind: "node", id: "source" }, cardKind: "table" },
      { id: "node:figure:plot", target: { kind: "node", id: "figure", facet: "plot" }, cardKind: "plot" },
      { id: "node:figure:stats", target: { kind: "node", id: "figure", facet: "stats" }, cardKind: "stats" },
    ]);
  });

  it("the seeded trio is FIFO-overridable: a new pin evicts the oldest default", () => {
    const s = createStore();
    s.set(seedDefaultStashAtom);
    s.set(pushStashAtom, { target: tNode("step:0"), cardKind: "table" as const });
    // the source table (oldest) drops; plot, stats, and the new pin remain.
    expect(s.get(stashAtom).map((e) => e.id)).toEqual([
      "node:figure:plot", "node:figure:stats", "node:step:0",
    ]);
  });
});
