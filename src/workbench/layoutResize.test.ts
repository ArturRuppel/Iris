import { describe, it, expect } from "vitest";
import {
  clampStashH, trackWidth, resizeColumns, slotSplit,
  MIN_STASH_H, MIN_CANVAS_H, PAD, GAP,
} from "./layoutResize";

describe("clampStashH", () => {
  it("passes a height that's within bounds", () => {
    expect(clampStashH(300, 800)).toBe(300);
  });
  it("floors at MIN_STASH_H", () => {
    expect(clampStashH(10, 800)).toBe(MIN_STASH_H);
  });
  it("caps so the canvas keeps MIN_CANVAS_H", () => {
    expect(clampStashH(99999, 800)).toBe(800 - MIN_CANVAS_H);
  });
  it("never returns below MIN_STASH_H even on a tiny overlay", () => {
    expect(clampStashH(500, 100)).toBe(MIN_STASH_H);
  });
});

describe("trackWidth", () => {
  it("subtracts padding and the inter-column gaps", () => {
    // 3 columns: 2*PAD + 2*GAP of chrome
    expect(trackWidth(1000, 3)).toBe(1000 - 2 * PAD - 2 * GAP);
  });
  it("never goes negative", () => {
    expect(trackWidth(5, 3)).toBe(0);
  });
});

describe("resizeColumns", () => {
  const cols = [1, 1, 1];
  const innerW = 900;                     // → 300px per equal column

  it("widens column i and shrinks i+1, conserving the total", () => {
    const next = resizeColumns(cols, 0, 150, innerW); // +150px → +0.5 weight
    expect(next).toEqual([1.5, 0.5, 1]);
    expect(next.reduce((a, b) => a + b, 0)).toBeCloseTo(3);
  });

  it("clamps so the shrinking column never drops below MIN_COL_PX", () => {
    const next = resizeColumns(cols, 0, 100000, innerW);
    // b floored at 120px → 0.4 weight; a takes the rest.
    expect(next[1]).toBeCloseTo(0.4);
    expect(next[0]).toBeCloseTo(1.6);
  });

  it("does not mutate the input", () => {
    const next = resizeColumns(cols, 0, 150, innerW);
    expect(next).not.toBe(cols);
    expect(cols).toEqual([1, 1, 1]);
  });

  it("ignores an out-of-range split index", () => {
    expect(resizeColumns(cols, 2, 50, innerW)).toBe(cols);
    expect(resizeColumns(cols, -1, 50, innerW)).toBe(cols);
  });
});

describe("slotSplit", () => {
  it("first slot owns only the split on its right", () => {
    expect(slotSplit(0, 0.1, 3)).toBe(0);
    expect(slotSplit(0, 0.9, 3)).toBe(0);
  });
  it("last slot owns only the split on its left", () => {
    expect(slotSplit(2, 0.1, 3)).toBe(1);
    expect(slotSplit(2, 0.9, 3)).toBe(1);
  });
  it("a middle slot picks the nearest split by cursor fraction", () => {
    expect(slotSplit(1, 0.2, 3)).toBe(0); // left half → left split
    expect(slotSplit(1, 0.8, 3)).toBe(1); // right half → right split
  });
  it("a lone full-width slot owns no split", () => {
    expect(slotSplit(0, 0.5, 1)).toBeNull();
  });
});
