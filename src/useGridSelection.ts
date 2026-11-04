import { useCallback, useEffect, useRef, useState } from "react";
import { rectOf, inRect, clampCell, rectsToTSV, parseTSV, type Cell, type Rect } from "./gridSelect";

/* The shared Excel-like interaction model for both spreadsheet grids — the tidy
   entry surface (DataEntry) and the grouped-sheet lens (GroupedSheet.Grid). It owns
   the parts that must NOT drift between them: the anchor/focus selection, mouse
   range-drag, keyboard navigation, and the key dispatch for copy / paste / clear /
   edit. Each grid keeps its own WRITE callbacks, because those legitimately differ
   (the lens writes numbers to engine rows and reports what it skipped; entry writes
   strings into a local array and grows freely). Cells are addressed in data
   coordinates, so a grid may virtualise its render however it likes.

   The grid guards editing: while an inline editor is open it should not forward
   keys here (e.g. `onKeyDown={(e) => { if (editing) return; grid.onKeyDown(e); }}`),
   so the editor owns its own keys. */

interface CellValueMatrix {
  [row: number]: (string | number | boolean | null)[];
}

export interface GridSelectionOps {
  nRows: number;
  nCols: number;
  // the display values, for Ctrl/Cmd+C (serialised via rectToTSV so screen == clipboard)
  values: CellValueMatrix;
  isEditable: (r: number, c: number) => boolean;
  // begin editing the active cell; `initial` set means type-to-overwrite
  beginEdit: (r: number, c: number, initial?: string) => void;
  // write a pasted block anchored at `anchor` — the grid owns coercion/growth/report
  pasteBlock: (anchor: Cell, block: string[][]) => void;
  // move a cut block: blank every cell in `source`, then write `block` at `anchor`,
  // as ONE write (one undo step, one notice) — target wins where they overlap. This
  // is Ctrl+X then Ctrl+V. Optional; if a grid omits it, a cut-paste falls back to
  // clearRect(source) + pasteBlock(anchor) (two writes, same result).
  moveCut?: (source: Rect[], anchor: Cell, block: string[][]) => void;
  // clear the cells in every rect — the grid owns the write. A discontiguous
  // (Ctrl+click) selection hands over several areas at once; the grid dedups any
  // overlap and writes/reports them as one batch.
  clearRect: (rects: Rect[]) => void;
  // scroll the active cell into view after keyboard navigation (optional)
  ensureVisible?: (cell: Cell) => void;
}

export interface GridSelection {
  sel: { anchor: Cell; focus: Cell } | null;
  rect: Rect | null;                 // the live (drag-extendable) range
  rects: Rect[];                     // every selected area — live range + Ctrl+click extras
  cutRects: Rect[];                  // the block staged for cut (Ctrl+X), or [] — for the dashed outline
  isActive: (r: number, c: number) => boolean;
  isSelected: (r: number, c: number) => boolean;
  isCut: (r: number, c: number) => boolean;   // in a cut-staged area — draws the "prepared for cut" contour
  selectCell: (r: number, c: number, extend: boolean) => void;
  selectRange: (anchor: Cell, focus: Cell) => void;
  clearSel: () => void;
  // `additive` (Ctrl/Cmd) keeps the existing areas and opens a new one, so several
  // disjoint blocks can be selected at once (Excel's Ctrl+click).
  onCellMouseDown: (r: number, c: number, shift: boolean, additive?: boolean) => void;
  onCellMouseEnter: (r: number, c: number) => void;
  // column-header drag, span-aware so it works at every grain: a header covers
  // columns [c0..c1] (a leaf is c0===c1, a band spans its group). mousedown starts,
  // mouseenter extends the column range from the drag's origin span; `additive`
  // adds this column block to a discontiguous selection instead of replacing it.
  onColMouseDown: (c0: number, c1: number, shift: boolean, additive?: boolean) => void;
  onColMouseEnter: (c0: number, c1: number) => void;
  // row-header press/drag: the row-wise twin of the column model.
  onRowMouseDown: (r: number, shift: boolean, additive?: boolean) => void;
  onRowMouseEnter: (r: number) => void;
  // the whole grid (the corner cell, Ctrl/Cmd+A)
  selectAll: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  // Touch (iPad): a finger drag scrolls, so a range is a LONG-PRESS then drag — on
  // a cell, a column header, a row header. The grid binds this to its scroll
  // element and tells it what lies under a point; it returns the unbind.
  bindTouch: (el: HTMLElement | null, hitAt: (x: number, y: number) => Hit | null) => () => void;
}

/* what a touch lands on, in data coordinates — the grid reads it off its DOM */
export type Hit =
  | { kind: "cell"; r: number; c: number }
  | { kind: "col"; c0: number; c1: number }
  | { kind: "row"; r: number }
  | { kind: "all" };

const LONG_PRESS_MS = 350;   // hold this long without moving, then drag to select
const PRESS_SLOP_PX = 10;    // moving further than this before the hold is a scroll

export function useGridSelection(ops: GridSelectionOps): GridSelection {
  const { nRows, nCols, values, isEditable, beginEdit, pasteBlock, moveCut, clearRect, ensureVisible } = ops;
  const [sel, setSel] = useState<{ anchor: Cell; focus: Cell } | null>(null);
  // committed disjoint areas from Ctrl+click; the live range (`sel`) is the one
  // still being dragged/extended. Together they are the selection (`rects`).
  const [extras, setExtras] = useState<Rect[]>([]);
  // the block staged for a cut (Ctrl+X): its content is already on the clipboard;
  // these rects draw the dashed "prepared for cut" contour and mark the source to
  // blank on the next paste (the move). Cleared by Escape / editing / a new copy /
  // Delete / a completed paste, and whenever the grid's shape changes underfoot.
  const [cutRects, setCutRects] = useState<Rect[]>([]);
  useEffect(() => { setCutRects([]); }, [nRows, nCols]);
  const dragging = useRef(false);                        // a body cell-range drag
  const colDragging = useRef(false);                     // a column drag across headers
  const colDragOrigin = useRef<[number, number] | null>(null);  // the origin header's [c0,c1]
  const rowDragging = useRef(false);                     // a row drag across row headers
  const rowDragOrigin = useRef<number | null>(null);

  const endDrag = () => {
    dragging.current = false; colDragging.current = false; colDragOrigin.current = null;
    rowDragging.current = false; rowDragOrigin.current = null;
  };
  // a range-drag ends wherever the mouse is released, even outside the grid
  useEffect(() => {
    const up = () => endDrag();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const rect = sel ? rectOf(sel.anchor, sel.focus) : null;
  const rects = rect ? [rect, ...extras] : extras;

  // `extend` (shift) keeps the anchor and moves the focus; a fresh selection also
  // drops any Ctrl+click extras (a plain click collapses to a single area).
  const selectCell = (r: number, c: number, extend: boolean) => {
    if (!extend) setExtras([]);
    setSel((s) => (extend && s ? { anchor: s.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } }));
  };
  const selectRange = (anchor: Cell, focus: Cell) => { setExtras([]); setSel({ anchor, focus }); };
  // select the full-height column block [c0..c1]; active cell at the top-left,
  // Excel-style (a header click puts the active cell at the top of the column).
  const selectColRange = (c0: number, c1: number) => {
    const lastRow = Math.max(0, nRows - 1);
    setSel({ anchor: { r: lastRow, c: c1 }, focus: { r: 0, c: c0 } });
  };
  // the full-width row block [r0..r1]; active cell at its left end
  const selectRowRange = (r0: number, r1: number) => {
    const lastCol = Math.max(0, nCols - 1);
    setSel({ anchor: { r: r1, c: lastCol }, focus: { r: r0, c: 0 } });
  };
  const selectAll = () => {
    if (nRows <= 0 || nCols <= 0) return;
    setExtras([]);
    setSel({ anchor: { r: nRows - 1, c: nCols - 1 }, focus: { r: 0, c: 0 } });
  };
  const clearSel = () => { setSel(null); setExtras([]); };

  // move the active cell by (dr,dc), clamped to the grid; `extend` keeps the anchor
  // (shift+arrow grows the range), otherwise collapses to a single cell. Either way
  // keyboard nav collapses to one area (drops any Ctrl+click extras).
  const step = (dr: number, dc: number, extend: boolean) => {
    setExtras([]);
    const f = sel?.focus ?? { r: 0, c: 0 };
    const next = clampCell(f.r + dr, f.c + dc, nRows, nCols);
    setSel((s) => (extend && s ? { anchor: s.anchor, focus: next } : { anchor: next, focus: next }));
    ensureVisible?.(next);
  };

  const copy = () => {
    setCutRects([]);   // a fresh copy supersedes any pending cut (Excel drops the ants)
    if (rects.length) void navigator.clipboard?.writeText(rectsToTSV(values as (string | number | boolean | null)[][], rects));
  };
  // Ctrl+X: the content goes on the clipboard exactly as copy does, and the block is
  // banked as the cut source — the dashed contour, and the cells the next paste will
  // blank (the move). A cut with no selection is a no-op.
  const cut = () => {
    if (!rects.length) return;
    void navigator.clipboard?.writeText(rectsToTSV(values as (string | number | boolean | null)[][], rects));
    setCutRects(rects);
  };
  const paste = async () => {
    if (!sel) return;
    const text = await navigator.clipboard?.readText().catch(() => "");
    const block = parseTSV(text ?? "");
    if (block.length === 0) return;
    const { r0, c0 } = rectOf(sel.anchor, sel.focus);
    // a pending cut turns paste into a MOVE: blank the source, write at the target.
    // moveCut does both as one write; without it, fall back to clear-then-paste.
    if (cutRects.length && moveCut) moveCut(cutRects, { r: r0, c: c0 }, block);
    else if (cutRects.length) { clearRect(cutRects); pasteBlock({ r: r0, c: c0 }, block); }
    else pasteBlock({ r: r0, c: c0 }, block);
    setCutRects([]);
    // highlight what landed (Excel selects the pasted block), clamped to the grid,
    // as one contiguous area (paste collapses any multi-area selection).
    const focus = clampCell(r0 + block.length - 1, c0 + (block[0]?.length ?? 1) - 1, nRows, nCols);
    setExtras([]);
    setSel({ anchor: { r: r0, c: c0 }, focus });
  };

  const onCellMouseDown = (r: number, c: number, shift: boolean, additive = false) => {
    // Ctrl/Cmd+click: bank the live range and open a fresh single-cell area (which a
    // drag can then grow), leaving the previously-selected blocks in place.
    if (additive && !shift) {
      if (rect) setExtras((e) => [...e, rect]);
      setSel({ anchor: { r, c }, focus: { r, c } });
      dragging.current = true;
      return;
    }
    // Ctrl+Shift+click extends the live area but keeps the extras; plain shift
    // extends and collapses to that one area. selectCell handles the extras drop.
    if (!additive) setExtras([]);
    setSel((s) => (shift && s ? { anchor: s.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } }));
    dragging.current = !shift;
  };
  const onCellMouseEnter = (r: number, c: number) => {
    if (dragging.current) setSel((s) => (s ? { anchor: s.anchor, focus: { r, c } } : s));
  };
  // a click-drag across column headers selects a range of columns (Excel's other
  // way to grab several, alongside shift-click). Works at every grain: a band
  // header passes its whole span [c0..c1], a leaf passes a single column. `additive`
  // (Ctrl/Cmd) banks the current selection and starts a new disjoint column block.
  const onColMouseDown = (c0: number, c1: number, shift: boolean, additive = false) => {
    if (additive && !shift) {
      if (rect) setExtras((e) => [...e, rect]);
      selectColRange(c0, c1);
      colDragOrigin.current = [c0, c1];
      colDragging.current = true;
      return;
    }
    if (shift && sel) {
      if (!additive) setExtras([]);
      const rx = rectOf(sel.anchor, sel.focus);          // grow the range to include this header
      selectColRange(Math.min(rx.c0, c0), Math.max(rx.c1, c1));
      colDragging.current = false;
      colDragOrigin.current = null;
    } else {
      setExtras([]);
      selectColRange(c0, c1);
      colDragOrigin.current = [c0, c1];
      colDragging.current = true;
    }
  };
  const onColMouseEnter = (c0: number, c1: number) => {
    const o = colDragOrigin.current;
    if (!colDragging.current || !o) return;
    selectColRange(Math.min(o[0], c0), Math.max(o[1], c1));  // origin span ∪ this header
  };
  // row headers: the same model turned sideways
  const onRowMouseDown = (r: number, shift: boolean, additive = false) => {
    if (additive && !shift) {
      if (rect) setExtras((e) => [...e, rect]);
      selectRowRange(r, r);
      rowDragOrigin.current = r;
      rowDragging.current = true;
      return;
    }
    if (shift && sel) {
      if (!additive) setExtras([]);
      const rx = rectOf(sel.anchor, sel.focus);
      selectRowRange(Math.min(rx.r0, r), Math.max(rx.r1, r));
      rowDragging.current = false;
      rowDragOrigin.current = null;
    } else {
      setExtras([]);
      selectRowRange(r, r);
      rowDragOrigin.current = r;
      rowDragging.current = true;
    }
  };
  const onRowMouseEnter = (r: number) => {
    const o = rowDragOrigin.current;
    if (!rowDragging.current || o == null) return;
    selectRowRange(Math.min(o, r), Math.max(o, r));
  };

  // --- touch: long-press, then drag. Native listeners (React's touch handlers are
  // passive, so they cannot stop the scroll); the latest handlers live in a ref so
  // the one-time binding never sees stale state. ---
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const armed = useRef(false);   // the hold has elapsed: moves now extend, not scroll
  const cancelPress = () => { if (press.current) window.clearTimeout(press.current.timer); press.current = null; };
  const beginAt = (hit: Hit) => {
    if (hit.kind === "cell") onCellMouseDown(hit.r, hit.c, false, false);
    else if (hit.kind === "col") onColMouseDown(hit.c0, hit.c1, false, false);
    else if (hit.kind === "row") onRowMouseDown(hit.r, false, false);
    else selectAll();
  };
  const extendTo = (hit: Hit) => {
    if (hit.kind === "cell") onCellMouseEnter(hit.r, hit.c);
    else if (hit.kind === "col") onColMouseEnter(hit.c0, hit.c1);
    else if (hit.kind === "row") onRowMouseEnter(hit.r);
  };
  const touch = {
    start: (hit: Hit | null, x: number, y: number) => {
      cancelPress(); armed.current = false;
      if (!hit) return;
      const timer = window.setTimeout(() => { press.current = null; armed.current = true; beginAt(hit); }, LONG_PRESS_MS);
      press.current = { x, y, timer };
    },
    move: (hit: Hit | null, x: number, y: number, e: TouchEvent) => {
      if (armed.current) { e.preventDefault(); if (hit) extendTo(hit); return; }
      const p = press.current;
      if (p && Math.hypot(x - p.x, y - p.y) > PRESS_SLOP_PX) cancelPress();   // a scroll, not a hold
    },
    end: (e: TouchEvent) => {
      // after a hold the lift must not become the synthesised tap (mousedown would
      // collapse the range to one cell)
      if (armed.current) { e.preventDefault(); armed.current = false; endDrag(); }
      cancelPress();
    },
    cancel: () => { armed.current = false; cancelPress(); endDrag(); },
  };
  const latest = useRef(touch);
  latest.current = touch;
  const bindTouch = useCallback((el: HTMLElement | null, hitAt: (x: number, y: number) => Hit | null) => {
    if (!el) return () => {};
    const pt = (e: TouchEvent) => e.touches[0] ?? e.changedTouches[0];
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) { latest.current.cancel(); return; }   // two fingers: pinch/scroll
      const t = pt(e); latest.current.start(hitAt(t.clientX, t.clientY), t.clientX, t.clientY);
    };
    const move = (e: TouchEvent) => { const t = pt(e); latest.current.move(hitAt(t.clientX, t.clientY), t.clientX, t.clientY, e); };
    const end = (e: TouchEvent) => latest.current.end(e);
    const cancel = () => latest.current.cancel();
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", cancel);
      latest.current.cancel();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && (e.key === "c" || e.key === "C")) { e.preventDefault(); copy(); return; }
    if (meta && (e.key === "x" || e.key === "X")) { e.preventDefault(); cut(); return; }
    if (meta && (e.key === "v" || e.key === "V")) { e.preventDefault(); void paste(); return; }
    if (meta && (e.key === "a" || e.key === "A")) { e.preventDefault(); selectAll(); return; }
    if (meta || e.altKey) return;
    const shift = e.shiftKey;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); step(-1, 0, shift); return;
      case "ArrowDown": e.preventDefault(); step(1, 0, shift); return;
      case "ArrowLeft": e.preventDefault(); step(0, -1, shift); return;
      case "ArrowRight": e.preventDefault(); step(0, 1, shift); return;
      case "Tab": e.preventDefault(); step(0, shift ? -1 : 1, false); return;
      case "Enter": e.preventDefault(); setCutRects([]); if (sel && isEditable(sel.focus.r, sel.focus.c)) beginEdit(sel.focus.r, sel.focus.c); return;
      case "Escape": e.preventDefault(); setCutRects([]); setExtras([]); if (sel) setSel({ anchor: sel.focus, focus: sel.focus }); return;
      case "Delete": case "Backspace": e.preventDefault(); setCutRects([]); if (rects.length) clearRect(rects); return;
    }
    // a printable character overwrites the active cell (Excel type-to-replace)
    if (e.key.length === 1 && sel && isEditable(sel.focus.r, sel.focus.c)) {
      e.preventDefault(); setCutRects([]); beginEdit(sel.focus.r, sel.focus.c, e.key);
    }
  };

  return {
    sel, rect, rects, cutRects,
    isActive: (r, c) => !!sel && sel.focus.r === r && sel.focus.c === c,
    isSelected: (r, c) => rects.some((x) => inRect(r, c, x)),
    isCut: (r, c) => cutRects.some((x) => inRect(r, c, x)),
    selectCell, selectRange, clearSel,
    onCellMouseDown, onCellMouseEnter, onColMouseDown, onColMouseEnter,
    onRowMouseDown, onRowMouseEnter, selectAll, onKeyDown, bindTouch,
  };
}
