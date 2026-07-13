import { describe, it, expect } from "vitest";
import { rectOf, inRect, edgesOf, clampCell, cellText, rectToTSV, rectsToTSV, parseTSV } from "./gridSelect";

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

describe("edgesOf — the boundary of a cut region (marching-ants outline)", () => {
  const block = [{ r0: 1, r1: 2, c0: 1, c1: 2 }];   // a 2×2 cut block
  it("a lone cell is bounded on all four sides", () => {
    expect(edgesOf(0, 0, [{ r0: 0, r1: 0, c0: 0, c1: 0 }]))
      .toEqual({ t: true, r: true, b: true, l: true });
  });
  it("the top-left cell of a block draws only its outer (top+left) edges", () => {
    expect(edgesOf(1, 1, block)).toEqual({ t: true, r: false, b: false, l: true });
  });
  it("the bottom-right cell draws only its outer (bottom+right) edges", () => {
    expect(edgesOf(2, 2, block)).toEqual({ t: false, r: true, b: true, l: false });
  });
  it("a discontiguous region outlines each area on its own", () => {
    // two disjoint columns: the gap between them is a real boundary on both sides
    const cols = [{ r0: 0, r1: 1, c0: 0, c1: 0 }, { r0: 0, r1: 1, c0: 2, c1: 2 }];
    expect(edgesOf(0, 0, cols)).toEqual({ t: true, r: true, b: false, l: true });
    expect(edgesOf(0, 2, cols)).toEqual({ t: true, r: true, b: false, l: true });
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

describe("rectsToTSV — a discontiguous (Ctrl+click) selection copies as TSV", () => {
  const values = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];
  it("a single rect is identical to rectToTSV", () => {
    const rect = { r0: 0, r1: 1, c0: 0, c1: 1 };
    expect(rectsToTSV(values, [rect])).toBe(rectToTSV(values, rect));
  });
  it("two disjoint columns keep the gap between them as a blank field", () => {
    // columns 0 and 2 selected, column 1 in the gap → blank, so paste reproduces it
    const cols = [
      { r0: 0, r1: 2, c0: 0, c1: 0 },
      { r0: 0, r1: 2, c0: 2, c1: 2 },
    ];
    expect(rectsToTSV(values, cols)).toBe("1\t\t3\n4\t\t6\n7\t\t9");
  });
  it("emits the bounding box across rows too, blanks outside every area", () => {
    // top-left cell and bottom-right cell → 3×3 bbox, only the two corners filled
    const corners = [
      { r0: 0, r1: 0, c0: 0, c1: 0 },
      { r0: 2, r1: 2, c0: 2, c1: 2 },
    ];
    expect(rectsToTSV(values, corners)).toBe("1\t\t\n\t\t\n\t\t9");
  });
  it("overlapping areas print each cell once (union membership)", () => {
    const overlap = [
      { r0: 0, r1: 1, c0: 0, c1: 1 },
      { r0: 1, r1: 2, c0: 1, c1: 2 },
    ];
    expect(rectsToTSV(values, overlap)).toBe("1\t2\t\n4\t5\t6\n\t8\t9");
  });
});

describe("parseTSV — clipboard text back into a grid of fields", () => {
  it("splits tabs into columns and newlines into rows", () => {
    expect(parseTSV("1\t2\n3\t4")).toEqual([["1", "2"], ["3", "4"]]);
  });
  it("drops the single trailing newline a spreadsheet appends", () => {
    expect(parseTSV("1\t2\n3\t4\n")).toEqual([["1", "2"], ["3", "4"]]);
  });
  it("normalises CRLF (Windows/Excel) to rows", () => {
    expect(parseTSV("1\t2\r\n3\t4")).toEqual([["1", "2"], ["3", "4"]]);
  });
  it("keeps empty fields (a blank between tabs) so columns stay aligned", () => {
    expect(parseTSV("1\t\t3")).toEqual([["1", "", "3"]]);
  });
  it("a single value is a 1×1 grid", () => {
    expect(parseTSV("42")).toEqual([["42"]]);
  });
  it("empty text is no rows", () => {
    expect(parseTSV("")).toEqual([]);
  });
  it("round-trips with rectToTSV", () => {
    const grid = [[1, 2, 3], [4, null, 6]];
    const tsv = rectToTSV(grid, { r0: 0, r1: 1, c0: 0, c1: 2 });
    expect(parseTSV(tsv)).toEqual([["1", "2", "3"], ["4", "", "6"]]);
  });
});
