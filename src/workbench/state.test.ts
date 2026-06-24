import { describe, it, expect } from "vitest";
import { createStore } from "jotai";
import {
  selectedTargetAtom, cardsAtom, nodePositionsAtom,
  openCardAtom, closeCardAtom, moveCardAtom, resizeCardAtom,
  toggleCardCollapsedAtom, collapseAllCardsAtom, clearWorkbenchAtom,
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

  it("clearWorkbench resets cards, selection, and node positions", () => {
    const s = createStore();
    s.set(openCardAtom, { target: tNode("source"), cardKind: "table" as const });
    s.set(nodePositionsAtom, { source: { x: 10, y: 20 } });
    s.set(clearWorkbenchAtom);
    expect(s.get(cardsAtom)).toHaveLength(0);
    expect(s.get(selectedTargetAtom)).toBeNull();
    expect(s.get(nodePositionsAtom)).toEqual({});
  });
});
