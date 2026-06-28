/* Pure geometry for the workbench tiling resize (Alt-drag + slider handles).
   Kept free of React/DOM so the clamps and weight transfers are unit-testable —
   the components below only measure rects and call into these. */

/* layout constants — kept in sync with the CSS (.txw-stash padding/gap, the
   44px topbar inset on .txw-rfcanvas). */
export const PAD = 10;          // .txw-stash padding
export const GAP = 10;          // grid gap between slots / handle width
export const TOPBAR = 44;       // .txw-rfcanvas top inset

export const MIN_STASH_H = 140; // the stash never collapses below this
export const MIN_CANVAS_H = 160; // always leave the DAG this much room
export const MIN_COL_PX = 120;  // a slot never gets narrower than this

/* Clamp the stash height to [MIN_STASH_H, contentH - MIN_CANVAS_H]. contentH is
   the overlay height minus the topbar (the space canvas+stash share). */
export function clampStashH(h: number, contentH: number): number {
  const max = Math.max(MIN_STASH_H, contentH - MIN_CANVAS_H);
  return Math.min(max, Math.max(MIN_STASH_H, h));
}

/* The inner track width the column weights distribute across: the stash client
   width minus its padding and the gaps between n columns. */
export function trackWidth(stashClientW: number, n: number): number {
  return Math.max(0, stashClientW - 2 * PAD - (n - 1) * GAP);
}

/* Move the split between cols[i] and cols[i+1] by dxPx within a track of innerW
   px. Weight is transferred only between the two adjacent columns (their sum is
   invariant), each clamped so neither falls below MIN_COL_PX. Returns new cols;
   the original is untouched. */
export function resizeColumns(
  cols: number[], i: number, dxPx: number, innerW: number,
): number[] {
  if (i < 0 || i >= cols.length - 1 || innerW <= 0) return cols;
  const total = cols.reduce((a, b) => a + b, 0);
  const perPx = total / innerW;          // weight per pixel
  const minW = MIN_COL_PX * perPx;       // the floor, in weight units
  const a = cols[i], b = cols[i + 1];
  // a grows / b shrinks as the divider moves right; clamp both to the floor.
  const df = Math.max(-(a - minW), Math.min(b - minW, dxPx * perPx));
  const next = cols.slice();
  next[i] = a + df;
  next[i + 1] = b - df;
  return next;
}

/* Which vertical split an Alt-drag inside a slot controls. A slot always also
   resizes the stash height (handled by the caller), so this only resolves the
   horizontal axis: the nearest interior split, or null when the slot has none
   on the relevant side. `xFrac` (0..1 across the slot) breaks the tie for a
   middle slot that has a split on both sides. */
export function slotSplit(
  slotIndex: number, xFrac: number, nCols: number,
): number | null {
  const left = slotIndex - 1;            // split between (i-1, i)
  const right = slotIndex;               // split between (i, i+1)
  const hasLeft = left >= 0;
  const hasRight = right <= nCols - 2;
  if (hasLeft && hasRight) return xFrac < 0.5 ? left : right;
  if (hasLeft) return left;
  if (hasRight) return right;
  return null;                           // a lone full-width slot
}
