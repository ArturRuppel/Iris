import { useEffect, useRef, useState } from "react";
import { rectOf, inRect, clampCell, rectToTSV, parseTSV, type Cell, type Rect } from "./gridSelect";

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
  // clear the cells in `rect` — the grid owns the write
  clearRect: (rect: Rect) => void;
  // scroll the active cell into view after keyboard navigation (optional)
  ensureVisible?: (cell: Cell) => void;
}

export interface GridSelection {
  sel: { anchor: Cell; focus: Cell } | null;
  rect: Rect | null;
  isActive: (r: number, c: number) => boolean;
  isSelected: (r: number, c: number) => boolean;
  selectCell: (r: number, c: number, extend: boolean) => void;
  selectRange: (anchor: Cell, focus: Cell) => void;
  clearSel: () => void;
  onCellMouseDown: (r: number, c: number, shift: boolean) => void;
  onCellMouseEnter: (r: number, c: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function useGridSelection(ops: GridSelectionOps): GridSelection {
  const { nRows, nCols, values, isEditable, beginEdit, pasteBlock, clearRect, ensureVisible } = ops;
  const [sel, setSel] = useState<{ anchor: Cell; focus: Cell } | null>(null);
  const dragging = useRef(false);

  // a range-drag ends wherever the mouse is released, even outside the grid
  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const rect = sel ? rectOf(sel.anchor, sel.focus) : null;

  const selectCell = (r: number, c: number, extend: boolean) =>
    setSel((s) => (extend && s ? { anchor: s.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } }));
  const selectRange = (anchor: Cell, focus: Cell) => setSel({ anchor, focus });
  const clearSel = () => setSel(null);

  // move the active cell by (dr,dc), clamped to the grid; `extend` keeps the anchor
  // (shift+arrow grows the range), otherwise collapses to a single cell.
  const step = (dr: number, dc: number, extend: boolean) => {
    const f = sel?.focus ?? { r: 0, c: 0 };
    const next = clampCell(f.r + dr, f.c + dc, nRows, nCols);
    setSel((s) => (extend && s ? { anchor: s.anchor, focus: next } : { anchor: next, focus: next }));
    ensureVisible?.(next);
  };

  const copy = () => {
    if (rect) void navigator.clipboard?.writeText(rectToTSV(values as (string | number | boolean | null)[][], rect));
  };
  const paste = async () => {
    if (!sel) return;
    const text = await navigator.clipboard?.readText().catch(() => "");
    const block = parseTSV(text ?? "");
    if (block.length === 0) return;
    const { r0, c0 } = rectOf(sel.anchor, sel.focus);
    pasteBlock({ r: r0, c: c0 }, block);
    // highlight what landed (Excel selects the pasted block), clamped to the grid
    const focus = clampCell(r0 + block.length - 1, c0 + (block[0]?.length ?? 1) - 1, nRows, nCols);
    setSel({ anchor: { r: r0, c: c0 }, focus });
  };

  const onCellMouseDown = (r: number, c: number, shift: boolean) => {
    selectCell(r, c, shift);
    dragging.current = !shift;
  };
  const onCellMouseEnter = (r: number, c: number) => {
    if (dragging.current) setSel((s) => (s ? { anchor: s.anchor, focus: { r, c } } : s));
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
      case "Escape": e.preventDefault(); if (sel) setSel({ anchor: sel.focus, focus: sel.focus }); return;
      case "Delete": case "Backspace": e.preventDefault(); if (rect) clearRect(rect); return;
    }
    // a printable character overwrites the active cell (Excel type-to-replace)
    if (e.key.length === 1 && sel && isEditable(sel.focus.r, sel.focus.c)) {
      e.preventDefault(); beginEdit(sel.focus.r, sel.focus.c, e.key);
    }
  };

  return {
    sel, rect,
    isActive: (r, c) => !!sel && sel.focus.r === r && sel.focus.c === c,
    isSelected: (r, c) => !!rect && inRect(r, c, rect),
    selectCell, selectRange, clearSel, onCellMouseDown, onCellMouseEnter, onKeyDown,
  };
}
