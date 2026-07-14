import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  activeSchemaAtom, activeHandleAtom, activeHierarchyAtom,
  bumpActiveHandleAtom, applyTableEditAtom, typeColorsAtom,
} from "../state";
import { engine, type Row, type ColumnDef } from "../types";
import {
  pivotability, pivotOverflow, longToWide, type GroupedSheet as Sheet,
} from "../grouped";
import { colOffsets, visibleCols, visibleRows } from "../gridWindow";
import { clampCell, cellText, edgesOf, type Cell, type Rect } from "../gridSelect";
import { useGridSelection } from "../useGridSelection";
import { DataViewToggle } from "./DataViewToggle";
import { DataEntry } from "./DataEntry";

/* The grouped-sheet lens: the active tidy table projected into the wide,
   merged-header layout, derived from the identifier spine — the identifiers form
   the nested bands (coarse → fine, outer → inner), and every non-identifier column
   is a leaf column of the little tidy sub-table under each band combination. The
   sub-tables append horizontally; their rows stack ragged, so every record shows
   and nothing collapses. It materializes the whole table (rowsWindow 0..n) and
   virtualises the render.

   Every edit is an op on the canonical tidy table (one write path): a value cell →
   edit_cell (per the cell's column and type, via valueOfCol); a band-header rename
   → relabel_category on that identifier column; a band delete → delete_rows. The
   two structural ops can lose data — a rename that collides with a sibling *merges*
   two values, a delete *drops rows* — so both are surfaced (a pre-warning or a
   stated row count), never performed silently. Nesting (which columns are
   identifiers, and their order) lives in the Data-hierarchy panel, not here. */
export function GroupedSheet() {
  const schema = useAtomValue(activeSchemaAtom);
  const handle = useAtomValue(activeHandleAtom);
  const hierarchy = useAtomValue(activeHierarchyAtom);
  const typeColors = useAtomValue(typeColorsAtom);
  const bumpHandle = useSetAtom(bumpActiveHandleAtom);
  const applyEdit = useSetAtom(applyTableEditAtom);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // a structural edit awaiting confirmation (it would lose data), and the last
  // outcome message — the honesty surface for delete_rows / relabel_category.
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const avail = pivotability(schema, hierarchy);

  /* a value edit is an op against the canonical tidy table: set the value column
     this cell belongs to (valueOfCol tells the Grid which one) on the tidy row it
     came from, bump the handle version, and let the effect refetch + re-pivot.
     Same write path as the tidy grid. */
  const commitEdit = async (rowId: string, colName: string, value: unknown) => {
    if (!handle) return;
    const { version, counts } = await engine.editCell(handle.id, rowId, colName, value);
    bumpHandle({ ...handle, version, counts });
  };

  /* a batch write for paste / range-clear: one editCells round-trip, one version
     bump, one re-pivot (not one per cell). The Grid has already resolved which
     cells map to tidy rows — skipping holes and anything past the sheet edge — and
     counted what it skipped; here we perform the write and state the outcome. Paste
     never grows the pivot (the grain is fixed by the spine), so overflow is
     reported, not silently absorbed. */
  const applyEdits = async (
    edits: { row_id: string; column: string; value: unknown }[],
    report: { wrote: number; skipped: number; kind: "paste" | "clear" | "move" },
  ) => {
    if (!handle) return;
    setNotice(null);
    if (edits.length > 0) {
      const { version, counts } = await engine.editCells(handle.id, edits);
      bumpHandle({ ...handle, version, counts });
    }
    const n = report.skipped;
    if (report.wrote === 0) {
      setNotice(n > 0
        ? `Nothing to ${report.kind} — the ${n === 1 ? "target cell is" : `${n} target cells are`} outside the editable data.`
        : `Nothing to ${report.kind}.`);
      return;
    }
    const verb = report.kind === "clear" ? "Cleared" : report.kind === "move" ? "Moved" : "Pasted";
    setNotice(`${verb} ${report.wrote} ${report.wrote === 1 ? "cell" : "cells"}`
      + (n > 0 ? ` — ${n} ${n === 1 ? "cell" : "cells"} outside the data ${n === 1 ? "was" : "were"} skipped.` : "."));
  };

  /* --- structural edits. Each resolves the header the user acted on to a tidy op,
     surfaces its loss, and routes the version/schema/count change through
     applyTableEditAtom so the effect refetches + re-pivots. --- */

  const doRelabel = async (column: string, from: string, to: string) => {
    if (!handle) return;
    const res = await engine.relabelCategory(handle.id, column, from, to);
    applyEdit({ version: res.version, counts: res.counts, schema: res.schema });
    setNotice(res.merged
      ? `Merged “${from}” into “${to}” — ${res.n} rows now share that level.`
      : `Renamed “${from}” to “${to}” (${res.n} rows).`);
  };

  const doDelete = async (ids: string[], label: string) => {
    if (!handle) return;
    const res = await engine.deleteRows(handle.id, ids);
    applyEdit({ version: res.version, counts: res.counts });
    setNotice(`Deleted ${res.removed} ${res.removed === 1 ? "row" : "rows"} in “${label}”.`);
  };

  /* a header rename at band `level` (0 = outer band … last = leaf columns).
     Renaming to a name a sibling already carries *merges* the two levels — that's
     lossy, so we warn and confirm first; a fresh name is applied immediately. The
     level maps to the band column at that position in the spec (the leaf row is
     the innermost band for single-value tables; for multi-value tables the leaf is
     a value label with no band column, so the lookup misses and renaming is a
     no-op). */
  const requestRelabel = (level: number, from: string, to: string) => {
    setNotice(null);
    const t = to.trim();
    if (!avail.ok || t === "" || t === from) return;
    const column = level < avail.spec.bandCols.length
      ? avail.spec.bandCols[level]?.name : undefined;
    if (!column || !sheet) return;
    const siblings = level < sheet.bands.length
      ? new Set(sheet.bands[level].map((c) => c.label))
      : new Set(sheet.columnLabels);
    if (siblings.has(t)) setPending({ kind: "relabel", column, from, to: t });
    else void doRelabel(column, from, t);
  };

  /* deleting a grouped column (or band) drops every tidy row under it — always
     lossy, so always confirmed with the exact count. Grid supplies the ids. */
  const requestDelete = (ids: string[], label: string) => {
    setNotice(null);
    if (ids.length > 0) setPending({ kind: "delete", ids, label });
  };

  const confirmPending = () => {
    const p = pending; setPending(null);
    if (!p) return;
    if (p.kind === "delete") void doDelete(p.ids, p.label);
    else void doRelabel(p.column, p.from, p.to);
  };

  /* materialize the whole table; refetch when the table or its version changes */
  useEffect(() => {
    if (!handle || !avail.ok) { setRows(null); return; }
    let stale = false;
    setFetchError(null);
    engine.rowsWindow(handle.id, 0, handle.n)
      .then((res) => { if (!stale) setRows(res.rows); })
      .catch((e) => { if (!stale) setFetchError(e instanceof Error ? e.message : String(e)); });
    return () => { stale = true; };
    // avail.ok is derived from schema+spine, covered by the deps below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle?.id, handle?.version, handle?.n, avail.ok]);

  // a version/id change means the pivot the pending edit was framed against is
  // gone; drop the stale confirmation so we never act on a moved target.
  useEffect(() => { setPending(null); }, [handle?.id, handle?.version]);

  // A near-diagonal pivot (a near-unique column as the finest grain) would make
  // longToWide allocate a multi-GB, ~all-holes grid and OOM the tab. Cost it first
  // (one O(rows) pass, no allocation); over the cap, refuse instead of building.
  const overflow = useMemo(
    () => (rows && avail.ok ? pivotOverflow(rows, avail.spec) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, avail.ok, JSON.stringify(hierarchy.spine)],
  );

  const sheet = useMemo<Sheet | null>(
    () => (rows && avail.ok && !overflow ? longToWide(rows, avail.spec) : null),
    // re-pivot on new data/availability or a spine re-order
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, avail.ok, overflow, JSON.stringify(hierarchy.spine)],
  );

  const body = (() => {
    // no table yet: the grouped pane IS the entry surface. Typing here and hitting
    // Create mints the session; the moment a handle exists this unmounts and the
    // live lens below takes over.
    if (!schema || !handle) return <DataEntry />;
    if (!avail.ok) return <Empty>{avail.reason}</Empty>;
    if (fetchError) return <Empty>Couldn’t load the table: {fetchError}</Empty>;
    if (overflow) return <Empty>{overflow.reason}</Empty>;
    if (!sheet) return <Empty>Loading…</Empty>;
    return (
      <Grid sheet={sheet} onCommit={commitEdit} onApply={applyEdits}
        onRelabel={requestRelabel} onDelete={requestDelete}
        colType={(name) => schema.columns.find((c) => c.name === name)?.type ?? "numeric"} />
    );
  })();

  return (
    <section className="pane table-pane">
      <div className="pane-head">
        <h2>Data</h2>
        <DataViewToggle />
        <span className="provenance">
          {!handle ? "new table"
            : avail.ok && sheet ? `${sheet.nRows} × ${sheet.nCols}`
            : `${handle.n} rows`}
        </span>
      </div>
      {pending && (
        <div className="gs-confirm" role="alertdialog">
          <span className="gs-confirm-msg">
            {pending.kind === "delete"
              ? `Delete ${pending.ids.length} ${pending.ids.length === 1 ? "row" : "rows"} under “${pending.label}”? This drops the data.`
              : `“${pending.to}” already exists — renaming “${pending.from}” merges the two levels. This can't be undone.`}
          </span>
          <button className="gs-confirm-go" onClick={confirmPending}>
            {pending.kind === "delete" ? "Delete" : "Merge"}
          </button>
          <button className="gs-confirm-cancel" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      {notice && !pending && (
        <div className="gs-notice" role="status">
          <span>{notice}</span>
          <button className="gs-notice-x" title="Dismiss" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}
      <div className="gs-host" style={{ "--type-identifier": typeColors.identifier } as CSSProperties}>{body}</div>
    </section>
  );
}

type Pending =
  | { kind: "delete"; ids: string[]; label: string }
  | { kind: "relabel"; column: string; from: string; to: string };

function Empty({ children }: { children: ReactNode }) {
  return <div className="gs-empty"><span>{children}</span></div>;
}

/* fixed layout metrics, in px. The grid is virtualised (only the visible window
   renders), so cells need known sizes: row height and header-row height are
   constants; column widths default uniform but are resized by hand (drag a leaf
   header's right edge). Never content-measured. */
const ROW_H = 25;          // body + row-index cell height
const HEAD_ROW_H = 26;     // each band row and the leaf-label row
const ROWHEAD_W = 76;      // the pinned grain column (the finest identifier) + corner
const DEFAULT_COL_W = 84;  // starting per-column width
const MIN_COL_W = 44;      // resize floor
const OVERSCAN = 2;        // extra rows/cols each side of the visible window

const rng = (a: number, b: number): number[] => {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
};

/* the merged-header grid, virtualised: only the visible column/row window is in
   the DOM, so a thousands-of-columns pivot scrolls instead of choking. Cells are
   absolutely positioned in canvas coordinates; the band header, the row-index
   column, and the corner are pinned to the viewport by translating each layer by
   the scroll offset (they sit above the body, opaque, masking rows that scroll
   under them).

   Editing is Excel-like. Single click selects a cell; click-drag or shift-click
   extends a rectangular selection; arrows / Tab / Enter move the active cell
   (shift+arrow grows the range), always clamped to the sheet. Double-click, Enter,
   or just typing edits the active cell (typing overwrites). Ctrl/Cmd+C copies the
   selection as TSV, so a block lifts straight into a spreadsheet. Selection lives
   in data coordinates, so it survives the virtualised window. Holes (cells with no
   tidy row) select and copy as blanks but never edit. Header cells keep the
   structural gestures: double-click a label to rename, hover for a × that deletes that column/band. Each leaf header has a
   right-edge handle that resizes its column (drag; that column only). */
function Grid({ sheet, onCommit, onApply, onRelabel, onDelete, colType }: {
  sheet: Sheet;
  onCommit: (rowId: string, colName: string, value: unknown) => void;
  onApply: (
    edits: { row_id: string; column: string; value: unknown }[],
    report: { wrote: number; skipped: number; kind: "paste" | "clear" | "move" },
  ) => void;
  onRelabel: (level: number, from: string, to: string) => void;
  onDelete: (ids: string[], label: string) => void;
  colType: (name: string) => ColumnDef["type"];
}) {
  const { bands, columnLabels, valueOfCol, factorLabels, grain, rowLabels, values, rowIds, nRows, nCols } = sheet;
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  const [draft, setDraft] = useState("");
  // a header rename in progress, keyed to disambiguate a band cell from a leaf.
  const [head, setHead] = useState<{ key: string; level: number; from: string } | null>(null);
  const [headDraft, setHeadDraft] = useState("");
  // Enter and the follow-on blur both fire for one commit; these guard the double.
  const done = useRef(false);
  const headDone = useRef(false);
  const hasFactors = factorLabels.length > 0;
  const leafLevel = bands.length;   // leaf headers sit one level below the bands

  // --- windowing: measure the port, track scroll, hold per-column widths ---
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [port, setPort] = useState({ w: 0, h: 0 });
  const [widths, setWidths] = useState<number[]>(() => Array<number>(nCols).fill(DEFAULT_COL_W));
  // a different pivot is a different set of columns: reset widths to the default.
  useEffect(() => { setWidths(Array<number>(nCols).fill(DEFAULT_COL_W)); }, [nCols]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setPort({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const offsets = useMemo(() => colOffsets(widths), [widths]);
  const totalW = offsets[nCols] ?? 0;
  const headerH = (bands.length + 1) * HEAD_ROW_H;
  const bodyH = nRows * ROW_H;
  const vCols = visibleCols(offsets, scroll.left, port.w, OVERSCAN);
  // the body scrolls under the pinned header, so its scroll origin is offset by it
  const vRows = visibleRows(ROW_H, nRows, Math.max(0, scroll.top - headerH), port.h, OVERSCAN);

  const canEditCell = (r: number, c: number) => rowIds[r]?.[c] != null;

  const startEdit = (r: number, c: number, initial?: string) => {
    if (!canEditCell(r, c)) return;   // holes have no tidy row; nothing to edit
    done.current = false;
    setDraft(initial ?? cellText(values[r][c]));
    setEdit({ r, c });   // the cell is already the selection focus in every entry path
  };
  const cancel = () => { done.current = true; setEdit(null); scrollRef.current?.focus(); };

  // scroll the port so the active cell clears the pinned header / row-index column.
  const ensureVisible = (cell: Cell) => {
    const el = scrollRef.current;
    if (!el) return;
    const left = ROWHEAD_W + offsets[cell.c];
    const right = left + (widths[cell.c] ?? DEFAULT_COL_W);
    const top = headerH + cell.r * ROW_H;
    const bottom = top + ROW_H;
    let sl = el.scrollLeft, st = el.scrollTop;
    if (left < sl + ROWHEAD_W) sl = left - ROWHEAD_W;
    else if (right > sl + el.clientWidth) sl = right - el.clientWidth;
    if (top < st + headerH) st = top - headerH;
    else if (bottom > st + el.clientHeight) st = bottom - el.clientHeight;
    el.scrollTo({ left: Math.max(0, sl), top: Math.max(0, st) });
  };

  // coerce a pasted/typed string to a leaf column's value, per its type — the same
  // rule the tidy grid uses, so paste and typing agree across both grids. Blank
  // clears to NA; numeric parses (unparseable -> NA); bool reads true/1; a
  // categorical keeps the raw string (leaf columns are no longer numbers-only).
  const coerce = (colName: string, raw: string): unknown => {
    const t = raw.trim();
    if (t === "") return null;
    const type = colType(colName);
    if (type === "numeric") return Number.isNaN(Number(t)) ? null : Number(t);
    if (type === "bool") return t === "true" || t === "1";
    return t;
  };

  type Edit = { row_id: string; column: string; value: unknown };

  // clear every editable cell in the selection to NA (Delete). Holes have no tidy
  // row so they are skipped; already-blank cells need no write. A discontiguous
  // (Ctrl+click) selection arrives as several rects — dedup where they overlap so a
  // cell is written and counted once.
  const clearRect = (rects: Rect[]) => {
    const edits: Edit[] = [];
    let skipped = 0;
    const seen = new Set<string>();
    for (const x of rects)
      for (let r = x.r0; r <= x.r1; r++)
        for (let c = x.c0; c <= x.c1; c++) {
          const id = rowIds[r][c];
          if (id == null) { skipped++; continue; }
          const key = `${id}\0${valueOfCol[c]}`;
          if (seen.has(key)) continue;         // overlapping areas → count once
          seen.add(key);
          if (values[r][c] == null) continue;  // already NA — nothing to write
          edits.push({ row_id: id, column: valueOfCol[c], value: null });
        }
    onApply(edits, { wrote: edits.length, skipped, kind: "clear" });
  };

  // paste a clipboard block anchored at the selection's top-left. Paste never grows
  // the pivot (grain is fixed by the spine), so cells past the sheet edge — and
  // holes with no tidy row — are skipped and reported, never silently invented.
  const pasteBlock = (anchor: Cell, block: string[][]) => {
    const edits: Edit[] = [];
    let skipped = 0;
    for (let i = 0; i < block.length; i++)
      for (let j = 0; j < block[i].length; j++) {
        const r = anchor.r + i, c = anchor.c + j;
        if (r >= nRows || c >= nCols) { skipped++; continue; }
        const id = rowIds[r][c];
        if (id == null) { skipped++; continue; }
        edits.push({ row_id: id, column: valueOfCol[c], value: coerce(valueOfCol[c], block[i][j]) });
      }
    onApply(edits, { wrote: edits.length, skipped, kind: "paste" });
  };

  // Ctrl+X then Ctrl+V: blank the cut source and write the block at the anchor as ONE
  // batch — one version bump, one re-pivot, one notice. Source clears and target
  // writes are keyed by (tidy row, value column); the paste is applied last so it
  // wins where the two overlap. Holes have no tidy row: they can't be cleared and
  // can't receive, so a target hole (or overflow) is skipped and reported, exactly
  // like a plain paste — the grain is fixed by the spine, so a move never invents rows.
  const moveCut = (source: Rect[], anchor: Cell, block: string[][]) => {
    const writes = new Map<string, Edit>();
    for (const x of source)
      for (let r = x.r0; r <= x.r1; r++)
        for (let c = x.c0; c <= x.c1; c++) {
          const id = rowIds[r]?.[c];
          if (id == null) continue;
          writes.set(`${id}\0${valueOfCol[c]}`, { row_id: id, column: valueOfCol[c], value: null });
        }
    let wrote = 0, skipped = 0;
    for (let i = 0; i < block.length; i++)
      for (let j = 0; j < block[i].length; j++) {
        const r = anchor.r + i, c = anchor.c + j;
        if (r >= nRows || c >= nCols) { skipped++; continue; }
        const id = rowIds[r]?.[c];
        if (id == null) { skipped++; continue; }
        writes.set(`${id}\0${valueOfCol[c]}`, { row_id: id, column: valueOfCol[c], value: coerce(valueOfCol[c], block[i][j]) });
        wrote++;
      }
    onApply([...writes.values()], { wrote, skipped, kind: "move" });
  };

  // the shared Excel selection/nav/copy/cut/paste/clear model (see useGridSelection)
  const gsel = useGridSelection({
    nRows, nCols, values,
    isEditable: canEditCell, beginEdit: startEdit, pasteBlock, moveCut, clearRect, ensureVisible,
  });

  // a header is "selected" when some selected area is a full-height column block
  // that covers the columns it sits over — so clicking a header lights it and its
  // body, and a Ctrl+click selection lights each disjoint block's headers.
  const colBlockSelected = (c0: number, c1: number) =>
    gsel.rects.some((rx) => rx.r0 === 0 && rx.r1 === nRows - 1 && c0 >= rx.c0 && c1 <= rx.c1);
  // press a header to select the columns it covers; drag across headers extends
  // the range (double-click renames). Every grain uses the same span-aware model:
  // a leaf covers one column, a band covers its whole group. Ctrl/Cmd adds a
  // disjoint column block instead of replacing the selection.
  const colMouseDown = (c0: number, c1: number, shift: boolean, additive: boolean) => {
    gsel.onColMouseDown(c0, c1, shift, additive);
    scrollRef.current?.focus();
  };

  const commit = (advance?: { dr: number; dc: number }) => {
    if (!edit || done.current) return;
    done.current = true;
    const { r, c } = edit;
    const id = rowIds[r][c];
    // coerce to the cell's column type (numeric / bool / categorical), like the tidy grid
    const value = coerce(valueOfCol[c], draft);
    if (id != null && value !== values[r][c]) onCommit(id, valueOfCol[c], value);
    setEdit(null);
    // Excel: Enter/Tab commit and step the active cell on; keep the keyboard alive
    // by returning focus to the grid (the unmounting input would otherwise drop it).
    if (advance) {
      const next = clampCell(r + advance.dr, c + advance.dc, nRows, nCols);
      gsel.selectCell(next.r, next.c, false);
      ensureVisible(next);
      scrollRef.current?.focus();
    }
  };

  const startHead = (key: string, level: number, from: string) => {
    headDone.current = false;
    setHeadDraft(from);
    setHead({ key, level, from });
  };
  const commitHead = () => {
    if (!head || headDone.current) return;
    headDone.current = true;
    onRelabel(head.level, head.from, headDraft);
    setHead(null);
  };
  const cancelHead = () => { headDone.current = true; setHead(null); };

  // drag a leaf header's right edge to set that one column's width (>= MIN_COL_W)
  const startResize = (c: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[c] ?? DEFAULT_COL_W;
    const move = (ev: MouseEvent) => {
      const w = Math.max(MIN_COL_W, startW + (ev.clientX - startX));
      setWidths((ws) => { const next = ws.slice(); next[c] = w; return next; });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // every non-blank tidy row id under leaf columns [start, start+span). Scans the
  // full data arrays (not the DOM), so it is correct even though only a window renders.
  const idsUnder = (start: number, span: number): string[] => {
    const ids: string[] = [];
    for (let r = 0; r < nRows; r++)
      for (let c = start; c < start + span; c++) {
        const id = rowIds[r][c];
        if (id != null) ids.push(id);
      }
    return ids;
  };

  const headInput = (
    <input className="gs-input gs-head-input" autoFocus value={headDraft}
      spellCheck={false} onChange={(e) => setHeadDraft(e.target.value)}
      onBlur={commitHead}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commitHead(); }
        else if (e.key === "Escape") { e.preventDefault(); cancelHead(); }
      }} />
  );

  return (
    <div className="gs-scroll" ref={scrollRef} tabIndex={0}
      onKeyDown={(e) => { if (edit || head) return; gsel.onKeyDown(e); }}
      onScroll={(e) => setScroll({ left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop })}>
      <div className="gs-canvas" style={{ width: ROWHEAD_W + totalW, height: headerH + bodyH }}>
        {/* body: only the visible window of value cells */}
        {rng(vRows.start, vRows.end).map((r) =>
          rng(vCols.start, vCols.end).map((c) => {
            const canEdit = rowIds[r][c] != null;
            const editing = !!edit && edit.r === r && edit.c === c;
            const active = gsel.isActive(r, c);
            const selected = gsel.isSelected(r, c);
            const cut = gsel.isCut(r, c);
            const ce = cut ? edgesOf(r, c, gsel.cutRects) : null;
            const cutCls = cut
              ? ` gs-cut${ce?.t ? " cut-t" : ""}${ce?.r ? " cut-r" : ""}${ce?.b ? " cut-b" : ""}${ce?.l ? " cut-l" : ""}`
              : "";
            return (
              <div key={`${r}:${c}`} data-r={r} data-c={c}
                className={`gs-cell${canEdit ? "" : " gs-blank"}${selected ? " gs-sel" : ""}${active ? " gs-active" : ""}${editing ? " gs-editing" : ""}${cutCls}`}
                style={{ left: ROWHEAD_W + offsets[c], top: headerH + r * ROW_H, width: widths[c], height: ROW_H }}
                onMouseDown={editing ? undefined : (e) => { gsel.onCellMouseDown(r, c, e.shiftKey, e.ctrlKey || e.metaKey); scrollRef.current?.focus(); }}
                onMouseEnter={() => gsel.onCellMouseEnter(r, c)}
                onDoubleClick={canEdit ? () => startEdit(r, c) : undefined}>
                {editing
                  ? <input className="gs-input" autoFocus value={draft}
                      spellCheck={false} inputMode={colType(valueOfCol[c]) === "numeric" ? "decimal" : "text"}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commit({ dr: 1, dc: 0 }); }
                        else if (e.key === "Tab") { e.preventDefault(); commit({ dr: 0, dc: e.shiftKey ? -1 : 1 }); }
                        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
                      }} />
                  : cellText(values[r][c])}
              </div>
            );
          }),
        )}

        {/* grain column, pinned left: the finest identifier's value per row, coloured
            as an identifier so it reads as a key. Falls back to the row number when
            there is no grain axis. */}
        <div className={`gs-rowcol${grain ? " gs-grain" : ""}`} style={{ transform: `translateX(${scroll.left}px)`, width: ROWHEAD_W, height: headerH + bodyH }}>
          {rng(vRows.start, vRows.end).map((r) => (
            <div key={r} className="gs-rowhead" title={grain ? `${grain.label}: ${rowLabels[r]}` : undefined}
              style={{ top: headerH + r * ROW_H, width: ROWHEAD_W, height: ROW_H }}>{grain ? rowLabels[r] : r + 1}</div>
          ))}
        </div>

        {/* band + leaf header, pinned top */}
        <div className="gs-header" style={{ transform: `translateY(${scroll.top}px)`, width: ROWHEAD_W + totalW, height: headerH }}>
          {bands.map((band, level) => {
            let offset = 0;
            return band.map((cell, i) => {
              const start = offset; offset += cell.span;
              // render only bands whose leaf span intersects the visible columns
              if (start + cell.span <= vCols.start || start >= vCols.end) return null;
              const key = `b${level}:${i}`;
              const editing = head?.key === key;
              return (
                <div key={key} data-band data-c0={start} data-c1={start + cell.span - 1}
                  className={`gs-head gs-band${colBlockSelected(start, start + cell.span - 1) ? " gs-sel" : ""}`}
                  title={factorLabels[level]}
                  style={{ left: ROWHEAD_W + offsets[start], top: level * HEAD_ROW_H,
                           width: offsets[start + cell.span] - offsets[start], height: HEAD_ROW_H }}
                  onMouseDown={editing ? undefined : (e) => colMouseDown(start, start + cell.span - 1, e.shiftKey, e.ctrlKey || e.metaKey)}
                  onMouseEnter={() => gsel.onColMouseEnter(start, start + cell.span - 1)}
                  onDoubleClick={() => startHead(key, level, cell.label)}>
                  {editing ? headInput : <span>{cell.label}</span>}
                  {!editing && (
                    <button className="gs-head-x" title={`Delete “${cell.label}”`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => { e.stopPropagation(); onDelete(idsUnder(start, cell.span), cell.label); }}>✕</button>
                  )}
                </div>
              );
            });
          })}
          {rng(vCols.start, vCols.end).map((c) => {
            const key = `L:${c}`;
            const editing = head?.key === key;
            const label = columnLabels[c];
            return (
              <div key={key} data-c={c} className={`gs-head gs-leaf${colBlockSelected(c, c) ? " gs-sel" : ""}`}
                title={factorLabels[factorLabels.length - 1]}
                style={{ left: ROWHEAD_W + offsets[c], top: bands.length * HEAD_ROW_H, width: widths[c], height: HEAD_ROW_H }}
                onMouseDown={editing ? undefined : (e) => colMouseDown(c, c, e.shiftKey, e.ctrlKey || e.metaKey)}
                onMouseEnter={() => gsel.onColMouseEnter(c, c)}
                onDoubleClick={hasFactors ? () => startHead(key, leafLevel, label) : undefined}>
                {editing ? headInput : <span>{label}</span>}
                {hasFactors && !editing && (
                  <button className="gs-head-x" title={`Delete “${label}”`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); onDelete(idsUnder(c, 1), label); }}>✕</button>
                )}
                <div className="gs-resize" title="Drag to resize"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => startResize(c, e)} />
              </div>
            );
          })}
        </div>

        {/* corner, pinned both */}
        <div className={`gs-corner${grain ? " gs-grain" : ""}`} title={grain?.label}
          style={{ transform: `translate(${scroll.left}px, ${scroll.top}px)`, width: ROWHEAD_W, height: headerH }}>{grain?.label ?? "#"}</div>
      </div>
    </div>
  );
}
