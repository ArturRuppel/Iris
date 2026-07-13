import { useEffect, useRef, useState } from "react";
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
  isActive: (r: number, c: number) => boolean;
  isSelected: (r: number, c: number) => boolean;
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
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function useGridSelection(ops: GridSelectionOps): GridSelection {
  const { nRows, nCols, values, isEditable, beginEdit, pasteBlock, clearRect, ensureVisible } = ops;
  const [sel, setSel] = useState<{ anchor: Cell; focus: Cell } | null>(null);
  // committed disjoint areas from Ctrl+click; the live range (`sel`) is the one
  // still being dragged/extended. Together they are the selection (`rects`).
  const [extras, setExtras] = useState<Rect[]>([]);
  const dragging = useRef(false);                        // a body cell-range drag
  const colDragging = useRef(false);                     // a column drag across headers
  const colDragOrigin = useRef<[number, number] | null>(null);  // the origin header's [c0,c1]

  // a range-drag ends wherever the mouse is released, even outside the grid
  useEffect(() => {
    const up = () => { dragging.current = false; colDragging.current = false; colDragOrigin.current = null; };
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
    if (rects.length) void navigator.clipboard?.writeText(rectsToTSV(values as (string | number | boolean | null)[][], rects));
  };
  const paste = async () => {
    if (!sel) return;
    const text = await navigator.clipboard?.readText().catch(() => "");
    const block = parseTSV(text ?? "");
    if (block.length === 0) return;
    const { r0, c0 } = rectOf(sel.anchor, sel.focus);
    pasteBlock({ r: r0, c: c0 }, block);
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && (e.key === "c" || e.key === "C")) { e.preventDefault(); copy(); return; }
    if (meta && (e.key === "v" || e.key === "V")) { e.preventDefault(); void paste(); return; }
    if (meta || e.altKey) return;
    const shift = e.shiftKey;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); step(-1, 0, shift); return;
      case "ArrowDown": e.preventDefault(); step(1, 0, shift); return;
      case "ArrowLeft": e.preventDefault(); step(0, -1, shift); return;
      case "ArrowRight": e.preventDefault(); step(0, 1, shift); return;
      case "Tab": e.preventDefault(); step(0, shift ? -1 : 1, false); return;
      case "Enter": e.preventDefault(); if (sel && isEditable(sel.focus.r, sel.focus.c)) beginEdit(sel.focus.r, sel.focus.c); return;
      case "Escape": e.preventDefault(); setExtras([]); if (sel) setSel({ anchor: sel.focus, focus: sel.focus }); return;
      case "Delete": case "Backspace": e.preventDefault(); if (rects.length) clearRect(rects); return;
    }
    // a printable character overwrites the active cell (Excel type-to-replace)
    if (e.key.length === 1 && sel && isEditable(sel.focus.r, sel.focus.c)) {
      e.preventDefault(); beginEdit(sel.focus.r, sel.focus.c, e.key);
    }
  };

  return {
    sel, rect, rects,
    isActive: (r, c) => !!sel && sel.focus.r === r && sel.focus.c === c,
    isSelected: (r, c) => rects.some((x) => inRect(r, c, x)),
    selectCell, selectRange, clearSel,
    onCellMouseDown, onCellMouseEnter, onColMouseDown, onColMouseEnter, onKeyDown,
  };
}
