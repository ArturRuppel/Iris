# Pivot Across the Grain (Slice 2 — Virtualisation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The grouped-sheet Grid renders only the visible column/row window, so a real COV2D pivot (thousands of columns × hundreds of rows) scrolls smoothly instead of materialising millions of DOM cells. Columns carry per-column, hand-draggable widths.

**Architecture:** Replace the hand-rolled `<table>` (which emits every `nRows × nCols` cell and welds the band headers to the full column set via `colSpan`) with an absolutely-positioned windowed grid inside one scroll port. A new pure module `src/gridWindow.ts` computes, from per-column widths and the scroll offset, which columns/rows are visible; the Grid renders only those, positioned in canvas coordinates. Band headers become a sticky top layer whose cells are placed at their true `x`; the row-index column is a sticky-left layer. Each column has an explicit width (default uniform); a drag handle on a leaf header's right edge resizes that one column. Widths are session-only Grid state.

**Tech Stack:** TypeScript, React, Jotai, Vitest (unit), Playwright (e2e). Pure windowing in `src/gridWindow.ts`; UI in `src/components/GroupedSheet.tsx`; CSS in `src/index.css`.

**Spec:** `docs/superpowers/specs/2026-07-13-pivot-across-grain-design.md` (§ "Scale — virtualisation, not a cap"; Slice 2 in § Staging).

**Key decisions locked in (with Artur):**
- Per-column explicit widths, resized by dragging a leaf header's right edge (spreadsheet gesture, that column only). "Fixed" = widths are explicit numbers that drive the windowing math, never content-measured.
- Row height is a single fixed constant. Header-row height is a single fixed constant.
- Widths live in Grid component state — session-only, reset on reload (consistent with card-state rules).
- No hard block on size; no soft-warning banner (spec).
- Data path is unchanged: we still fetch all rows and pivot in memory (`longToWide`). Slice 2 fixes the DOM blocker only; the in-memory pivot of 180k rows is a one-time O(rows) compute, not the bottleneck.

---

## File Structure

- `src/gridWindow.ts` — CREATE. Pure windowing: `colOffsets(widths)`, `visibleCols(offsets, scroll, viewport, overscan)`, `visibleRows(rowH, nRows, scroll, viewport, overscan)`. No DOM, no React.
- `src/gridWindow.test.ts` — CREATE. Unit tests for the three functions incl. edges.
- `src/components/GroupedSheet.tsx` — MODIFY. Rewrite the `Grid` function to virtualise + per-column resize. `GroupedSheet` (the outer component, data fetch, pivot, structural-edit handlers) is unchanged.
- `src/index.css` — MODIFY. Replace the `<table>`-based `.gs-grid` rules with the absolutely-positioned windowed-grid rules.

No change to `grouped.ts` / the pivot math — Slice 1 already produced the `GroupedSheet` data shape (`values`, `rowIds`, `bands`, `columnLabels`, `valueOfCol`, `factorLabels`, `nRows`, `nCols`) this Grid consumes.

---

## Task 1: Pure windowing module

**Files:**
- Create: `src/gridWindow.ts`
- Test: `src/gridWindow.test.ts`

The windowing math is the one piece with a crisp contract; test it in isolation, no DOM.

- [ ] **Step 1: Write the failing tests**

Create `src/gridWindow.test.ts`:

```ts
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
    // window at the left edge, overscan 1 cannot go below 0
    expect(visibleCols(offsets, 0, 100, 1)).toEqual({ start: 0, end: 3 });
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/gridWindow.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/gridWindow.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/gridWindow.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/gridWindow.ts src/gridWindow.test.ts
git commit -m "feat(grouped): pure column/row windowing (pivot-across-grain slice 2)"
```

---

## Task 2: Virtualise the Grid + per-column drag-resize

**Files:**
- Modify: `src/components/GroupedSheet.tsx` (the `Grid` function only, lines ~197-350)
- Modify: `src/index.css` (the `.gs-grid` / `.gs-*` block, lines ~444-471)

Rewrite `Grid` to an absolutely-positioned windowed grid. The outer `GroupedSheet` component, its data fetch, the pivot memo, and all structural-edit handlers (`commitEdit`, `requestRelabel`, `requestDelete`, `confirmPending`) are UNCHANGED — only the presentational `Grid` and its CSS change. The `onCommit`/`onRelabel`/`onDelete` props keep their Slice-1 signatures, because those handlers act on data indices `(r, c)` and tidy row ids, which survive windowing untouched.

**Layout constants** (module-scope in the component file):
```tsx
const ROW_H = 25;          // body + row-index cell height
const HEAD_ROW_H = 26;     // each band row and the leaf-label row
const ROWHEAD_W = 34;      // the sticky row-index / corner column
const DEFAULT_COL_W = 84;  // starting per-column width
const MIN_COL_W = 44;      // resize floor
const OVERSCAN = 2;        // extra rows/cols each side of the window
```

**DOM structure** (inside the scroll port):
- `.gs-scroll` — the ONE scroll port. `overflow:auto`, fixed height, `position:relative`. A ref + `ResizeObserver` reads its `clientWidth/clientHeight`; `onScroll` reads `scrollLeft/scrollTop` into state.
- `.gs-canvas` — a spacer establishing the scroll extent: `width = ROWHEAD_W + total column width`, `height = headerH + nRows*ROW_H`, `position:relative`.
- `.gs-header` — sticky top layer (`position:sticky; top:0`, height `headerH`, spanning the canvas width, `z-index:2`). Band cells and leaf-label cells for the visible column range only, each absolutely positioned at `left = ROWHEAD_W + offsets[c]`. A band cell over leaf `[s, s+span)` renders iff its span intersects the visible range, at `left = ROWHEAD_W + offsets[s]`, `width = offsets[s+span] - offsets[s]`. The leaf header carries a right-edge resize handle.
- `.gs-corner` — sticky top+left (`z-index:3`), the `#` box.
- `.gs-rowcol` — sticky-left layer (`position:sticky; left:0`, width `ROWHEAD_W`, `z-index:1`) holding the visible row-index cells at `top = headerH + r*ROW_H`.
- Body cells — for the visible `[rowStart,rowEnd) × [colStart,colEnd)`, each `.gs-cell` absolutely positioned at `left = ROWHEAD_W + offsets[c]`, `top = headerH + r*ROW_H`, `width = widths[c]`, `height = ROW_H`.

`headerH = (bands.length + 1) * HEAD_ROW_H`.

**State added to `Grid`:**
```tsx
const scrollRef = useRef<HTMLDivElement>(null);
const [scroll, setScroll] = useState({ left: 0, top: 0 });
const [port, setPort] = useState({ w: 0, h: 0 });
const [widths, setWidths] = useState<number[]>(() => Array<number>(nCols).fill(DEFAULT_COL_W));
```
- Reset `widths` when `nCols` changes (a re-pivot): `useEffect(() => setWidths(Array(nCols).fill(DEFAULT_COL_W)), [nCols])`.
- `ResizeObserver` on `scrollRef` → `setPort`. `onScroll` → `setScroll`.
- `offsets = useMemo(() => colOffsets(widths), [widths])`.
- `vCols = visibleCols(offsets, scroll.left, port.w, OVERSCAN)`, `vRows = visibleRows(ROW_H, nRows, Math.max(0, scroll.top - headerH), port.h, OVERSCAN)` (subtract the sticky header height from the body scroll origin).

**Resize handler:** on a leaf header's `.gs-resize` handle, `onMouseDown` captures `startX = e.clientX`, `startW = widths[c]`, attaches `mousemove`/`mouseup` on `window`; `mousemove` sets `widths[c] = Math.max(MIN_COL_W, startW + (e.clientX - startX))`; `mouseup` detaches. Guard so a resize drag does not also trigger the header's double-click rename.

**Preserve from the current Grid** (behaviour, not layout): click-to-edit a value cell (`startEdit`/`commit`/`cancel`, numeric coercion, `onCommit(id, valueOfCol[c], value)`, holes read-only); double-click a header to rename (`startHead`/`commitHead`, `onRelabel(level, from, to)`); the header `✕` delete calling `onDelete(idsUnder(...), label)`; `idsUnder(start, span)` unchanged (it scans the data arrays, not the DOM, so it still works with only a window rendered). The edit `<input>` and header-rename `<input>` render in place of the cell/label content for the one editing cell, which is inside the visible window by construction (you can only start editing a cell you clicked).

- [ ] **Step 1: Rewrite the `Grid` function**

Replace the entire `Grid` function (from `function Grid(` to its closing `}`) with the windowed implementation described above. Add the layout constants above `Grid`. Import the windowing helpers at the top of the file:
```tsx
import { colOffsets, visibleCols, visibleRows } from "../gridWindow";
```

- [ ] **Step 2: Rewrite the CSS**

In `src/index.css`, replace the `.gs-grid`-based rules (the `<table>` styling, roughly lines 444-471) with rules for the new structure: `.gs-scroll` (the port), `.gs-canvas`, `.gs-header`, `.gs-corner`, `.gs-rowcol`, `.gs-cell` (absolute, box-sizing:border-box, 1px border, `4px 7px` padding, `tabular-nums`), `.gs-cell.gs-blank`, `.gs-cell.gs-editing`, `.gs-head`/`.gs-band`/`.gs-leaf` header cells (absolute, centered, `font-weight`), `.gs-head-x` (unchanged behaviour), `.gs-resize` (a ~5px-wide right-edge grab strip, `cursor:col-resize`), `.gs-rowhead`, `.gs-input`/`.gs-head-input`. Keep the visual language (`--line`, `--panel2`, `--accent`, `--faint`) so it still reads as one surface with the entry grid. The `.gs-host { height: 560px }` rule stays; `.gs-scroll` fills it (`height:100%`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Unit suite (nothing should regress)**

Run: `npx vitest run`
Expected: PASS. If any component test asserted the old `<table>`/`<thead>` structure, update it to the new class hooks (search the test dir for `gs-grid`, `thead`, `de-band`).

- [ ] **Step 5: Commit**

```bash
git add src/components/GroupedSheet.tsx src/index.css
git commit -m "feat(grouped): windowed grid render + per-column drag-resize (slice 2)"
```

---

## Task 3: e2e — the lens still round-trips, and far columns virtualise

**Files:**
- Modify/inspect: `e2e/` (the grouped-sheet spec added in the lens epic)

- [ ] **Step 1: Find the grouped e2e and run it**

Run: `ls e2e/ | grep -i group` then run the grouped-sheet script(s) against the live app (engine + vite up via `dev.sh`).
Expected: PASS — the lens opens on a spine-carrying table, a body-cell edit round-trips into the tidy grid, rename/delete still surface their cost. Update any assertion that queried the old `<table>`/`<thead>`/`colSpan` DOM to the new class hooks (`.gs-cell`, `.gs-header`, `.gs-band`, `.gs-leaf`).

- [ ] **Step 2: Add a virtualisation assertion**

In the grouped e2e (or a new `e2e/grouped_virtualisation_test.mjs` mirroring its harness), on a table wide enough to exceed the viewport: assert a far-right column's cell is NOT in the DOM initially, scroll the `.gs-scroll` port right, then assert that cell IS now rendered (and a far-left cell has been unmounted). This is the behavioural proof that windowing works, not just that it looks the same.

- [ ] **Step 3: Commit**

```bash
git add e2e
git commit -m "test(e2e): grouped grid virtualises columns on scroll (slice 2)"
```

---

## Task 4: Full verification + real-app drive

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green.

- [ ] **Step 2: e2e suite**

Run the standalone `e2e/*.mjs` scripts against a freshly-restarted engine + vite (`dev.sh`), so we are not testing a zombie engine.
Expected: green (modulo any test unrelated to this work, noted explicitly).

- [ ] **Step 3: Drive it in the real app**

Load a wide spine-carrying table (a trimmed COV2D export with `frame`/`t1_event_id` typed identifier, or a synthetic wide table). Confirm: the pivot renders and scrolls smoothly both axes; the sticky band headers and row-index column stay put; dragging a leaf header's right edge resizes that column only; a body-cell edit round-trips; rename/delete still work. Record what you saw.

---

## Self-Review notes (for the implementer)

- The row-index vertical position must account for the sticky header: body/row-index `top = headerH + r*ROW_H`, and the row window is computed from `scroll.top - headerH` (clamped at 0), so row 0 sits just under the header.
- `visibleCols` is a linear scan; that is deliberate and fine for a few thousand columns run once per scroll event. Do not prematurely binary-search it.
- Holes (null `rowIds[r][c]`) stay read-only exactly as before — the `editable` check is unchanged, just applied per visible cell.
- Do not measure content to size columns anywhere — widths come only from `DEFAULT_COL_W` and drag. That is the whole point of "fixed, by hand".
- Widths state resets on `nCols` change; that is intended (a different pivot is a different set of columns). Do not try to persist widths across re-pivots in Slice 2.
