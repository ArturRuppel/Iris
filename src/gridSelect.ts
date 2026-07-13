/* Pure selection geometry for the grouped-sheet grid — the Excel-like range model,
   kept free of DOM/React so it can be unit-tested and reasoned about on its own
   (the sibling of gridWindow.ts). Cells are addressed in DATA coordinates (r, c),
   never DOM, so this composes with the virtualised render: a cell is "in the
   selection" by its index, whether or not it is currently mounted. */

export interface Cell {
  r: number;
  c: number;
}

/* an inclusive rectangle of cells, normalised so r0<=r1 and c0<=c1 regardless of
   which corner the user dragged from. */
export interface Rect {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/* the rectangle spanned by a selection's anchor (fixed corner) and focus (the
   moving/active corner). Excel: click sets both; shift-click / shift-arrow move
   the focus while the anchor stays put. */
export function rectOf(anchor: Cell, focus: Cell): Rect {
  return {
    r0: Math.min(anchor.r, focus.r),
    r1: Math.max(anchor.r, focus.r),
    c0: Math.min(anchor.c, focus.c),
    c1: Math.max(anchor.c, focus.c),
  };
}

export function inRect(r: number, c: number, x: Rect): boolean {
  return r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1;
}

/* clamp a (possibly out-of-bounds) cell back onto a grid of nRows×nCols. Arrow /
   Tab / Enter navigation walks by ±1 then clamps, so the active cell never leaves
   the sheet (Excel stops at the edge, it does not wrap). */
export function clampCell(r: number, c: number, nRows: number, nCols: number): Cell {
  return {
    r: Math.max(0, Math.min(nRows - 1, r)),
    c: Math.max(0, Math.min(nCols - 1, c)),
  };
}

type CellValue = string | number | boolean | null;

/* one cell's clipboard text. Matches the grid's on-screen formatting: null (a NA
   or a pivot hole) is blank, a boolean is the word, everything else is stringified.
   Shared by the grid render (fmt) and the copy path so screen == clipboard. */
export function cellText(v: CellValue): string {
  return v == null ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v);
}

/* serialise an inclusive rect of the value grid to TSV (tab between columns,
   newline between rows) — the format Excel/Sheets/Numbers put on and take off the
   clipboard, so a copied block pastes straight into a spreadsheet and vice versa.
   Holes and NAs come out as empty fields, exactly as they read on screen. */
export function rectToTSV(values: CellValue[][], x: Rect): string {
  const lines: string[] = [];
  for (let r = x.r0; r <= x.r1; r++) {
    const cells: string[] = [];
    for (let c = x.c0; c <= x.c1; c++) cells.push(cellText(values[r]?.[c] ?? null));
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}
