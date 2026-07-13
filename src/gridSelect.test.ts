import { describe, it, expect } from "vitest";
import { rectOf, inRect, clampCell, cellText, rectToTSV } from "./gridSelect";

describe("rectOf — normalise anchor/focus into an inclusive rect", () => {
  it("orders the corners regardless of drag direction", () => {
    // dragged up-left: focus is above-left of the anchor
    expect(rectOf({ r: 3, c: 4 }, { r: 1, c: 2 })).toEqual({ r0: 1, r1: 3, c0: 2, c1: 4 });
    // dragged down-right: same rect
    expect(rectOf({ r: 1, c: 2 }, { r: 3, c: 4 })).toEqual({ r0: 1, r1: 3, c0: 2, c1: 4 });
  });

  it("a single cell is a 1×1 rect", () => {
    expect(rectOf({ r: 2, c: 5 }, { r: 2, c: 5 })).toEqual({ r0: 2, r1: 2, c0: 5, c1: 5 });
  });
});

describe("inRect — membership (inclusive on all edges)", () => {
  const x = { r0: 1, r1: 3, c0: 2, c1: 4 };
  it("includes the corners and interior", () => {
    expect(inRect(1, 2, x)).toBe(true);
    expect(inRect(3, 4, x)).toBe(true);
    expect(inRect(2, 3, x)).toBe(true);
  });
  it("excludes cells just outside", () => {
    expect(inRect(0, 2, x)).toBe(false);
    expect(inRect(1, 1, x)).toBe(false);
    expect(inRect(4, 4, x)).toBe(false);
  });
});

describe("clampCell — navigation stops at the edge, never wraps", () => {
  it("clamps below zero to zero", () => {
    expect(clampCell(-1, 3, 10, 10)).toEqual({ r: 0, c: 3 });
    expect(clampCell(3, -1, 10, 10)).toEqual({ r: 3, c: 0 });
  });
  it("clamps past the last row/col to the last index", () => {
    expect(clampCell(99, 4, 10, 10)).toEqual({ r: 9, c: 4 });
    expect(clampCell(4, 99, 10, 10)).toEqual({ r: 4, c: 9 });
  });
  it("leaves an in-bounds cell untouched", () => {
    expect(clampCell(5, 6, 10, 10)).toEqual({ r: 5, c: 6 });
  });
});

describe("cellText — screen == clipboard formatting", () => {
  it("null (NA or pivot hole) is an empty field", () => {
    expect(cellText(null)).toBe("");
  });
  it("booleans are the word, numbers and strings stringify", () => {
    expect(cellText(true)).toBe("true");
    expect(cellText(false)).toBe("false");
    expect(cellText(42)).toBe("42");
    expect(cellText(0)).toBe("0");
    expect(cellText("KO")).toBe("KO");
  });
});

describe("rectToTSV — a copied block is spreadsheet-pasteable TSV", () => {
  const values = [
    [1, 2, 3],
    [4, null, 6],   // a hole in the middle
    [7, 8, 9],
  ];
  it("tabs between columns, newlines between rows", () => {
    expect(rectToTSV(values, { r0: 0, r1: 1, c0: 0, c1: 1 }))
      .toBe("1\t2\n4\t");
  });
  it("a hole becomes an empty field, not a dropped column", () => {
    expect(rectToTSV(values, { r0: 1, r1: 1, c0: 0, c1: 2 }))
      .toBe("4\t\t6");
  });
  it("the whole grid round-trips its shape", () => {
    expect(rectToTSV(values, { r0: 0, r1: 2, c0: 0, c1: 2 }))
      .toBe("1\t2\t3\n4\t\t6\n7\t8\t9");
  });
  it("a single cell is just its text, no separators", () => {
    expect(rectToTSV(values, { r0: 2, r1: 2, c0: 2, c1: 2 })).toBe("9");
  });
});
