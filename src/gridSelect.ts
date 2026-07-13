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

/* which edges of a cell lie on the boundary of a region (a set of rects) — an
   edge is drawn when the neighbour across it is NOT itself in the region. Used to
   paint a cut ("prepared for cut") selection as one dashed outline around the
   block, Excel's marching-ants rectangle, rather than a busy grid of per-cell
   dashes. Only meaningful for a cell that is itself in the region; callers guard
   on membership. A cell at the sheet edge has no neighbour there, so that edge is
   on the boundary and is drawn. */
export interface Edges { t: boolean; r: boolean; b: boolean; l: boolean; }
export function edgesOf(r: number, c: number, rects: Rect[]): Edges {
  const has = (rr: number, cc: number) => rects.some((x) => inRect(rr, cc, x));
  return { t: !has(r - 1, c), r: !has(r, c + 1), b: !has(r + 1, c), l: !has(r, c - 1) };
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

/* serialise a possibly-discontiguous selection (several Ctrl+click areas) to TSV.
   Emits the bounding box of every rect; a cell inside any rect prints its value, a
   cell in the gap between areas prints blank — so the clipboard mirrors what's
   highlighted (two selected columns keep the gap between them). A single rect is
   byte-for-byte rectToTSV. Overlapping rects are fine: membership is a union. */
export function rectsToTSV(values: CellValue[][], rects: Rect[]): string {
  if (rects.length <= 1) return rectToTSV(values, rects[0] ?? { r0: 0, r1: -1, c0: 0, c1: -1 });
  const r0 = Math.min(...rects.map((x) => x.r0));
  const r1 = Math.max(...rects.map((x) => x.r1));
  const c0 = Math.min(...rects.map((x) => x.c0));
  const c1 = Math.max(...rects.map((x) => x.c1));
  const lines: string[] = [];
  for (let r = r0; r <= r1; r++) {
    const cells: string[] = [];
    for (let c = c0; c <= c1; c++)
      cells.push(rects.some((x) => inRect(r, c, x)) ? cellText(values[r]?.[c] ?? null) : "");
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/* the inverse of rectToTSV: parse clipboard text into a grid of string fields.
   Accepts the TSV a spreadsheet puts on the clipboard — tabs between columns,
   newlines between rows, CRLF or LF — and drops the single trailing newline
   spreadsheets tend to append (so it does not read as a phantom empty last row).
   Returns [] for empty text. Cells stay strings; the caller coerces per column. */
export function parseTSV(text: string): string[][] {
  const norm = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (norm === "") return [];
  return norm.split("\n").map((line) => line.split("\t"));
}
