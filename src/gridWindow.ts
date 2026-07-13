/* Pure windowing for the grouped-sheet Grid: given per-column widths (or a uniform
   row height) and the current scroll offset, which cells are visible. No DOM, no
   React — so the Grid can render only the window and stay fast on huge pivots. */

/* Cumulative left edges: offsets[c] = sum of widths[0..c-1]; offsets[nCols] = total.
   Length is widths.length + 1. */
export function colOffsets(widths: number[]): number[] {
  const offsets = [0];
  for (const w of widths) offsets.push(offsets[offsets.length - 1] + w);
  return offsets;
}

export interface Range { start: number; end: number }  // half-open [start, end)

/* The columns whose [offsets[c], offsets[c+1]) span intersects the viewport
   [scroll, scroll + viewport), widened by `overscan` columns each side and clamped
   to [0, nCols]. Linear scan — nCols is at most a few thousand, run once per scroll. */
export function visibleCols(offsets: number[], scroll: number, viewport: number, overscan: number): Range {
  const nCols = offsets.length - 1;
  if (nCols <= 0) return { start: 0, end: 0 };
  const lo = scroll, hi = scroll + viewport;
  let start = nCols, end = 0;
  for (let c = 0; c < nCols; c++) {
    if (offsets[c + 1] > lo && offsets[c] < hi) {   // this column touches the window
      if (c < start) start = c;
      if (c + 1 > end) end = c + 1;
    }
  }
  if (end === 0) return { start: 0, end: 0 };        // nothing visible
  return {
    start: Math.max(0, start - overscan),
    end: Math.min(nCols, end + overscan),
  };
}

/* Uniform-height rows: the row window for a vertical scroll of [scroll, scroll +
   viewport), widened by `overscan` rows and clamped to [0, nRows). */
export function visibleRows(rowH: number, nRows: number, scroll: number, viewport: number, overscan: number): Range {
  if (nRows <= 0 || rowH <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scroll / rowH) - overscan);
  const end = Math.min(nRows, Math.ceil((scroll + viewport) / rowH) + overscan);
  return { start, end: Math.max(start, end) };
}
