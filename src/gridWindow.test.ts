import { describe, it, expect } from "vitest";
import { colOffsets, visibleCols, visibleRows } from "./gridWindow";

describe("colOffsets — prefix sums of column widths", () => {
  it("returns cumulative left edges with a trailing total", () => {
    expect(colOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
  });
  it("empty widths -> just the origin", () => {
    expect(colOffsets([])).toEqual([0]);
  });
});

describe("visibleCols — column indices intersecting the viewport", () => {
  const offsets = colOffsets([100, 100, 100, 100, 100]);  // [0,100,200,300,400,500]

  it("returns the half-open [start,end) of columns touching the window", () => {
    // viewport [150, 350) touches columns 1,2,3
    expect(visibleCols(offsets, 150, 200, 0)).toEqual({ start: 1, end: 4 });
  });
  it("applies overscan and clamps to bounds", () => {
    // window [0,100) shows only col 0; overscan 1 adds col 1 right, clamps left at 0
    expect(visibleCols(offsets, 0, 100, 1)).toEqual({ start: 0, end: 2 });
    // window at the right edge clamps end to nCols (5)
    expect(visibleCols(offsets, 450, 100, 1)).toEqual({ start: 3, end: 5 });
  });
  it("no columns -> an empty range", () => {
    expect(visibleCols([0], 0, 100, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("visibleRows — uniform-height row window", () => {
  it("floor/ceil of the scroll window, with overscan and clamp", () => {
    // rowH 20, 100 rows; window [50,130) -> rows 2..7 (ceil(130/20)=7)
    expect(visibleRows(20, 100, 50, 80, 0)).toEqual({ start: 2, end: 7 });
    expect(visibleRows(20, 100, 50, 80, 2)).toEqual({ start: 0, end: 9 });
  });
  it("clamps end to nRows", () => {
    expect(visibleRows(20, 5, 0, 1000, 0)).toEqual({ start: 0, end: 5 });
  });
  it("no rows -> empty", () => {
    expect(visibleRows(20, 0, 0, 100, 0)).toEqual({ start: 0, end: 0 });
  });
});
