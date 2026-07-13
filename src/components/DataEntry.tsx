import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { entryBandsAtom, entryColumnsAtom, entryRowsAtom, entryValueNameAtom } from "../state";
import { type EntryCell as Cell, coverAt } from "../entryMelt";
import { inRect, edgesOf, type Cell as GridCell, type Rect } from "../gridSelect";
import { useGridSelection } from "../useGridSelection";

/* The header is a stack of grouping rows over a row of value columns — exactly
   the merged-cell layout people build in Excel. `bands[0]` is the topmost
   (coarsest) grouping row; each row below is finer; the value columns are finest
   of all. Every band partitions the columns into cells, and the partitions form
   a refinement chain (each band's cells nest inside the band above) — that
   laminar invariant is what lets the whole thing melt to a tidy table: one
   categorical column per band level, plus the value column. Merges that would
   break it (a cell straddling two parent groups) are refused, not stored.

   Editing is select-then-act, like a spreadsheet: click a header cell to select
   it (a group cell selects all its columns), shift-click to extend within that
   row, then Merge / Unmerge / Delete from the toolbar. */
/* a run of adjacent cells [a..b] in one header row; `row` is a band level, or
   `bands.length` for the value-column row */
interface Sel { row: number; a: number; b: number }

/* ---- pure header helpers (operate on band rows; defaults + coverAt + the melt
   live in entryMelt.ts, shared with the mint action) ---- */

/* starting column index of each cell in a band row */
function starts(row: Cell[]): number[] {
  const s: number[] = [];
  let a = 0;
  for (const c of row) { s.push(a); a += c.span; }
  return s;
}
/* the atomic column partition — the finest level, sitting below the last band */
function colCells(nCols: number): Cell[] {
  return Array.from({ length: nCols }, () => ({ span: 1, label: "" }));
}
/* collapse cells [a..b] of a band row into one (first non-blank label wins) */
function mergeRange(row: Cell[], a: number, b: number): Cell[] {
  const merged: Cell = {
    span: row.slice(a, b + 1).reduce((s, c) => s + c.span, 0),
    label: row.slice(a, b + 1).map((c) => c.label).find((l) => l.trim()) ?? "",
  };
  return [...row.slice(0, a), merged, ...row.slice(b + 1)];
}
/* drop the columns in `drop` from a band row, keeping each cell's span in sync and
   dropping any cell all of whose columns were cut. Works for a discontiguous set,
   so deleting a Ctrl+click column selection stays laminar. */
function dropBandCols(row: Cell[], drop: Set<number>): Cell[] {
  const out: Cell[] = [];
  let s = 0;
  for (const cell of row) {
    let kept = 0;
    for (let c = s; c < s + cell.span; c++) if (!drop.has(c)) kept++;
    if (kept > 0) out.push({ ...cell, span: kept });
    s += cell.span;
  }
  return out;
}

/** "Enter data": a spreadsheet with nested, merged headers — the wide grouped
 *  layout people keep in their heads and their Excel sheets (repeating columns
 *  under a merged grouping band, nestable to any depth). Type or paste like a
 *  spreadsheet; the header hierarchy melts into a tidy table (one categorical
 *  column per band level + one value column) via the import pipeline, so parsing,
 *  decimal commas, and type inference come for free.
 *
 *  Rendered *inline* as the empty state of the grouped-sheet lens: with no table
 *  loaded, the grouped pane IS this entry surface. There is no explicit Create
 *  step — switching to Workbench mints the table from whatever was typed
 *  (mintFromEntryAtom), after which GroupedSheet unmounts this and shows the live
 *  lens. The entry document lives in atoms (entry*Atom) so it survives that mode
 *  switch; only the cell editor, header selection, and refusal notes are local. */
export function DataEntry() {
  const [bands, setBands] = useAtom(entryBandsAtom);
  const [columnLabels, setColumnLabels] = useAtom(entryColumnsAtom);
  const [rows, setRows] = useAtom(entryRowsAtom);
  const [valueName, setValueName] = useAtom(entryValueNameAtom);
  const [sel, setSel] = useState<Sel | null>(null);
  const [note, setNote] = useState<string | null>(null);      // refused-action explanation
  // the single active cell editor (Excel-like: click selects, type/dbl-click edits)
  const [edit, setEdit] = useState<{ r: number; c: number } | null>(null);
  const [draft, setDraft] = useState("");
  // the header-label editor — a header cell selects on click and edits on
  // double-click, exactly like a body cell (row is a band level, or the value-
  // column row; i is the cell index within that row).
  const [hEdit, setHEdit] = useState<{ row: number; i: number } | null>(null);
  const [hDraft, setHDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusScroll = () => scrollRef.current?.focus();
  const bandDrag = useRef<number | null>(null);   // origin cell index of a grouping-row drag
  useEffect(() => {
    const up = () => { bandDrag.current = null; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const nCols = columnLabels.length;
  const depth = bands.length + 1;
  const cell = (r: number, c: number) => rows[r]?.[c] ?? "";

  /* ---- selection ----
     Two coordinated layers. The crisp body range (`gsel`, defined below) is the
     Excel selection and the single source of truth for copy / delete / the column
     span. The header "pick" (`sel`) drives merge/unmerge on the grouping rows,
     which have no body of their own. Every gesture clears the other layer, so the
     two never double-paint — the bug this replaces. The gsel-derived helpers live
     just below the hook; `cellSelected` (header pick) needs only `sel`. */
  const cellSelected = (row: number, i: number): boolean =>
    !!sel && sel.row === row && i >= sel.a && i <= sel.b;

  /* ---- cell edits ---- */
  const setCell = (r: number, c: number, v: string) =>
    setRows((rs) => {
      const next = rs.map((row) => row.slice());
      while (next.length <= r) next.push(Array(nCols).fill(""));
      next[r][c] = v;
      return next;
    });

  /* ---- Excel-like editing (shared model via useGridSelection) ---- */
  const beginEdit = (r: number, c: number, initial?: string) => {
    setNote(null);
    setDraft(initial ?? cell(r, c));
    setEdit({ r, c });   // the cell is already the selection focus in every entry path
  };
  const cancelEdit = () => { setEdit(null); focusScroll(); };

  /* paste a clipboard block anchored at the selection's top-left, growing rows
     (and columns, joining the rightmost group) to fit — the Excel paste. Entry has
     no holes and grows freely, so nothing is skipped. */
  const pasteBlock = (anchor: GridCell, block: string[][]) => {
    const need = anchor.c + Math.max(...block.map((g) => g.length));
    if (need > nCols) addColumns(need - nCols);
    setRows((rs) => {
      const width = Math.max(nCols, need);
      const next = rs.map((row) => {
        const cp = row.slice();
        while (cp.length < width) cp.push("");
        return cp;
      });
      block.forEach((line, dr) => {
        const r = anchor.r + dr;
        while (next.length <= r) next.push(Array(width).fill(""));
        line.forEach((val, dc) => { next[r][anchor.c + dc] = val.trim(); });
      });
      return next;
    });
  };
  const clearRect = (rects: Rect[]) => setRows((rs) =>
    rs.map((row, r) => row.map((v, c) =>
      (rects.some((x) => inRect(r, c, x)) ? "" : v))));

  /* Ctrl+X then Ctrl+V: blank the cut source and write the block at the anchor in a
     single update (one undo step) — target wins where the two overlap, because the
     paste runs after the clear. Same growth rules as pasteBlock. */
  const moveCut = (source: Rect[], anchor: GridCell, block: string[][]) => {
    const need = anchor.c + Math.max(...block.map((g) => g.length));
    if (need > nCols) addColumns(need - nCols);
    setRows((rs) => {
      const width = Math.max(nCols, need);
      const next = rs.map((row) => {
        const cp = row.slice();
        while (cp.length < width) cp.push("");
        return cp;
      });
      for (const x of source)
        for (let r = x.r0; r <= x.r1 && r < next.length; r++)
          for (let c = x.c0; c <= x.c1 && c < width; c++) next[r][c] = "";
      block.forEach((line, dr) => {
        const r = anchor.r + dr;
        while (next.length <= r) next.push(Array(width).fill(""));
        line.forEach((val, dc) => { next[r][anchor.c + dc] = val.trim(); });
      });
      return next;
    });
  };

  const ensureVisible = (c: GridCell) => queueMicrotask(() =>
    scrollRef.current?.querySelector(`td[data-r="${c.r}"][data-c="${c.c}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" }));

  const gsel = useGridSelection({
    nRows: rows.length, nCols, values: rows,
    isEditable: () => true, beginEdit, pasteBlock, moveCut, clearRect, ensureVisible,
  });

  /* the value columns the body selection fully spans — only full-height (whole-
     column) areas count, which is exactly what a column-header click, a top-to-
     bottom drag, or a Ctrl+click across headers produces. A discontiguous selection
     yields several, so Delete can drop disjoint columns. Drives + Column / Delete
     and the header/band highlight. */
  const selectedCols = (): number[] => {
    const cols = new Set<number>();
    for (const x of gsel.rects)
      if (x.r0 === 0 && x.r1 === rows.length - 1)
        for (let c = x.c0; c <= x.c1; c++) cols.add(c);
    return [...cols].sort((a, b) => a - b);
  };
  const colSel = selectedCols();
  const colSelSet = new Set(colSel);
  const colSelected = (c: number): boolean => colSelSet.has(c);
  const spanSelected = (c0: number, c1: number): boolean => {
    for (let c = c0; c <= c1; c++) if (!colSelSet.has(c)) return false;
    return true;
  };
  /* press a grouping cell: pick it for merge/unmerge (header layer) and select the
     body columns it spans (Excel layer), so the selection reads end to end. A drag
     across grouping cells extends both — like dragging across leaf headers, one
     grain up. `bandDrag` remembers the origin cell so the drag grows symmetrically. */
  const bandMouseDown = (level: number, i: number, shift: boolean, additive: boolean) => {
    setNote(null);
    const row = bands[level], st = starts(row);
    // Ctrl/Cmd: add this group's columns as a disjoint block. Merge needs one
    // contiguous pick, so a discontiguous selection drops the header pick entirely.
    if (additive) {
      setSel(null);
      bandDrag.current = null;
      gsel.onColMouseDown(st[i], st[i] + row[i].span - 1, false, true);
      focusScroll();
      return;
    }
    const a = shift && sel && sel.row === level ? Math.min(sel.a, i) : i;
    const b = shift && sel && sel.row === level ? Math.max(sel.b, i) : i;
    setSel({ row: level, a, b });
    bandDrag.current = shift ? null : i;
    gsel.onColMouseDown(st[a], st[b] + row[b].span - 1, shift);
    focusScroll();
  };
  const bandMouseEnter = (level: number, i: number) => {
    if (bandDrag.current == null || !sel || sel.row !== level) return;
    const a = Math.min(bandDrag.current, i), b = Math.max(bandDrag.current, i);
    setSel({ row: level, a, b });
    const row = bands[level], st = starts(row);
    gsel.onColMouseEnter(st[a], st[b] + row[b].span - 1);
  };
  /* press a value-column header: select the whole column (Excel), drop any
     grouping pick; dragging across headers (onColMouseEnter) extends the range. */
  const colMouseDown = (c: number, shift: boolean, additive: boolean) => {
    setNote(null);
    setSel(null);
    gsel.onColMouseDown(c, c, shift, additive);
    focusScroll();
  };

  /* commit the active edit and (on Enter/Tab) step the active cell on, growing a
     row at the bottom like Excel; keep the keyboard alive by refocusing the grid. */
  const commit = (dr = 0, dc = 0) => {
    if (!edit) return;
    const { r, c } = edit;
    setCell(r, c, draft);
    setEdit(null);
    if (dr || dc) {
      const R = r + dr;
      if (dr > 0 && R >= rows.length) addRow();
      gsel.selectCell(Math.max(0, R), Math.max(0, Math.min(c + dc, nCols - 1)), false);
      focusScroll();
    }
  };

  /* ---- row / column structure ---- */
  const addRow = () => setRows((rs) => [...rs, Array(nCols).fill("")]);
  const removeRow = (r: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== r) : rs));

  /* insert `n` blank columns after column `after`, growing the band cell that
     covers it at every level so the new columns join the same groups. */
  const addColumns = (n: number, after = nCols - 1) => {
    const at = Math.max(0, Math.min(after, nCols - 1));
    setBands((bs) => bs.map((row) => {
      const idx = coverAt(row, at);
      return row.map((c, i) => (i === idx ? { ...c, span: c.span + n } : c));
    }));
    setColumnLabels((ls) => [...ls.slice(0, at + 1), ...Array(n).fill(""), ...ls.slice(at + 1)]);
    setRows((rs) => rs.map((row) => {
      const cp = row.slice();
      cp.splice(at + 1, 0, ...Array(n).fill(""));
      return cp;
    }));
    setSel(null);
  };
  /* "+ Column": add one, after the last selected column if there is a selection. */
  const addColumn = () => addColumns(1, colSel.length ? colSel[colSel.length - 1] : nCols - 1);

  const renameCell = (level: number, i: number, v: string) =>
    setBands((bs) => bs.map((row, L) =>
      (L === level ? row.map((c, k) => (k === i ? { ...c, label: v } : c)) : row)));
  const renameColumn = (c: number, v: string) =>
    setColumnLabels((ls) => ls.map((l, i) => (i === c ? v : l)));

  /* double-click a header to rename it (single click already selected it) */
  const beginHeadEdit = (row: number, i: number, current: string) => {
    setNote(null);
    setHDraft(current);
    setHEdit({ row, i });
  };
  const commitHead = () => {
    if (!hEdit) return;
    const { row, i } = hEdit;
    if (row < bands.length) renameCell(row, i, hDraft);
    else renameColumn(i, hDraft);
    setHEdit(null);
    focusScroll();
  };
  const cancelHead = () => { setHEdit(null); focusScroll(); };

  /* ---- grouping rows (bands) ---- */
  /* add a coarser grouping row on top, cloned from the current top partition so
     it starts exactly as grouped as what's below it (keeping the refinement
     chain valid) — then merge its cells to build bigger super-groups. */
  const addGroupingRow = () => {
    setBands((bs) => {
      const top = bs.length ? bs[0] : colCells(nCols);
      return [top.map((c) => ({ span: c.span, label: "" })), ...bs];
    });
    setSel(null); setNote(null);
  };
  /* drop a whole grouping level — the remaining bands still nest (refinement is
     transitive), so this is always safe; the value columns are untouched. */
  const removeBand = (level: number) => {
    setBands((bs) => bs.filter((_, L) => L !== level));
    setSel(null); setNote(null);
  };

  /* ---- selection actions (toolbar) ---- */
  const canMerge = !!sel && sel.row < bands.length && sel.b > sel.a;
  const mergeSelected = () => {
    if (!canMerge || !sel) return;
    const level = sel.row, st = starts(bands[level]);
    if (level > 0) {   // a merge may not straddle a boundary of the band above
      const parent = bands[level - 1];
      if (coverAt(parent, st[sel.a]) !== coverAt(parent, st[sel.b])) {
        const label = parent[coverAt(parent, st[sel.a])].label;
        setNote(`Can't merge across ${label ? `“${label}”` : "the group above"}. ` +
          "The selected columns are in different groups one level up, so a merged " +
          "cell here would put a column in two groups at once — that can't melt to a " +
          "tidy table. Merge within one group, or ungroup the row above first.");
        return;
      }
    }
    setNote(null);
    setBands((bs) => bs.map((r, L) => (L === level ? mergeRange(r, sel.a, sel.b) : r)));
    setSel({ row: level, a: sel.a, b: sel.a });
  };

  /* the sub-spans a merged cell would break into if ungrouped: the cells of the
     band directly below it (or single columns if it's the lowest band). */
  const subSpans = (level: number, i: number): number[] => {
    const row = bands[level], st = starts(row);
    const startCol = st[i], span = row[i].span;
    const below = level + 1 < bands.length ? bands[level + 1] : colCells(nCols);
    const bst = starts(below);
    const out: number[] = [];
    for (let k = 0; k < below.length; k++)
      if (bst[k] >= startCol && bst[k] < startCol + span) out.push(below[k].span);
    return out;
  };
  const canUnmerge = !!sel && sel.row < bands.length && sel.a === sel.b
    && bands[sel.row][sel.a].span > 1 && subSpans(sel.row, sel.a).length > 1;
  const unmergeSelected = () => {
    if (!canUnmerge || !sel) return;
    const level = sel.row, i = sel.a;
    const subs = subSpans(level, i).map((s) => ({ span: s, label: "" }));
    setBands((bs) => bs.map((r, L) =>
      (L === level ? [...r.slice(0, i), ...subs, ...r.slice(i + 1)] : r)));
    setSel({ row: level, a: i, b: i + subs.length - 1 });
    setNote(null);
  };

  const canDelete = colSel.length > 0 && colSel.length < nCols;
  const deleteSelectedColumns = () => {
    if (!canDelete) return;
    const drop = colSelSet;
    setBands((bs) => bs.map((row) => dropBandCols(row, drop)));
    setColumnLabels((ls) => ls.filter((_, i) => !drop.has(i)));
    setRows((rs) => rs.map((row) => row.filter((_, i) => !drop.has(i))));
    setSel(null); gsel.clearSel(); setNote(null);
  };

  /* the inline header-label editor, shared by band cells and column headers */
  const headInput = (
    <input className="de-headinput" autoFocus value={hDraft} spellCheck={false}
      onChange={(e) => setHDraft(e.target.value)}
      onBlur={commitHead}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commitHead(); }
        else if (e.key === "Escape") { e.preventDefault(); cancelHead(); }
      }} />
  );

  return (
    <div className="de-inline">
            <p className="de-hint">
              Type or paste your data — replicates run down, conditions across.
              Add grouping rows to nest conditions. Switch to Workbench to plot;
              your entries become one tidy table automatically.
            </p>

            <div className="de-scroll" ref={scrollRef} tabIndex={0}
              onKeyDown={(e) => {
                if (edit) return;
                // header label inputs (band/column names) keep their own keys
                if ((e.target as HTMLElement).tagName === "INPUT") return;
                gsel.onKeyDown(e);
              }}>
              <table className="de-grid">
                <thead>
                  {bands.map((row, level) => (
                    <tr key={`b${level}`} className="de-band">
                      <th className="de-corner">
                        <button className="de-icon" title="delete grouping row"
                          onClick={() => removeBand(level)}>✕</button>
                      </th>
                      {row.map((c, i) => {
                        const editing = hEdit?.row === level && hEdit?.i === i;
                        return (
                          <th key={i} colSpan={c.span}
                            className={`de-groupcell${cellSelected(level, i) || spanSelected(starts(row)[i], starts(row)[i] + c.span - 1) ? " de-sel" : ""}`}
                            onMouseDown={(e) => bandMouseDown(level, i, e.shiftKey, e.ctrlKey || e.metaKey)}
                            onMouseEnter={() => bandMouseEnter(level, i)}
                            onDoubleClick={() => beginHeadEdit(level, i, c.label)}>
                            <div className="de-grouphead">
                              {editing ? headInput
                                : <span className={`de-headtext${c.label.trim() ? "" : " de-ph"}`}>
                                    {c.label.trim() || "group"}</span>}
                            </div>
                          </th>
                        );
                      })}
                      {level === 0 && <th className="de-addcol" rowSpan={depth} />}
                    </tr>
                  ))}
                  <tr className="de-heads">
                    <th className="de-corner">#</th>
                    {columnLabels.map((label, c) => {
                      const editing = hEdit?.row === bands.length && hEdit?.i === c;
                      return (
                        <th key={c} data-colhead={c}
                          className={`de-colcell${colSelected(c) ? " de-sel" : ""}`}
                          onMouseDown={(e) => colMouseDown(c, e.shiftKey, e.ctrlKey || e.metaKey)}
                          onMouseEnter={() => gsel.onColMouseEnter(c, c)}
                          onDoubleClick={() => beginHeadEdit(bands.length, c, label)}>
                          <div className="de-colhead">
                            {editing ? headInput
                              : <span className={`de-headtext${label.trim() ? "" : " de-ph"}`}>
                                  {label.trim() || "column"}</span>}
                          </div>
                        </th>
                      );
                    })}
                    {bands.length === 0 && <th className="de-addcol" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((_, r) => (
                    <tr key={r}>
                      <td className="de-rowhead">
                        <button className="de-icon" title="delete row"
                          onClick={() => removeRow(r)}>{r + 1}</button>
                      </td>
                      {columnLabels.map((_, c) => {
                        const editing = edit?.r === r && edit?.c === c;
                        const cut = gsel.isCut(r, c);
                        const e = cut ? edgesOf(r, c, gsel.cutRects) : null;
                        const cls = [
                          "de-body",
                          gsel.isSelected(r, c) ? "de-sel" : "",
                          gsel.isActive(r, c) ? "de-active" : "",
                          cut ? "de-cut" : "",
                          e?.t ? "cut-t" : "", e?.r ? "cut-r" : "", e?.b ? "cut-b" : "", e?.l ? "cut-l" : "",
                        ].filter(Boolean).join(" ");
                        return (
                          <td key={c} data-r={r} data-c={c} className={cls}
                            onMouseDown={editing ? undefined
                              : (e) => { setSel(null); gsel.onCellMouseDown(r, c, e.shiftKey, e.ctrlKey || e.metaKey); focusScroll(); }}
                            onMouseEnter={() => gsel.onCellMouseEnter(r, c)}
                            onDoubleClick={() => beginEdit(r, c)}>
                            {editing
                              ? <input className="de-cell" autoFocus data-cell={`${r}:${c}`}
                                  value={draft} spellCheck={false}
                                  onChange={(e) => setDraft(e.target.value)}
                                  onBlur={() => commit()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.preventDefault(); commit(1, 0); }
                                    else if (e.key === "Tab") { e.preventDefault(); commit(0, e.shiftKey ? -1 : 1); }
                                    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                                  }} />
                              : <span className="de-celltext">{cell(r, c)}</span>}
                          </td>
                        );
                      })}
                      {bands.length === 0 && <td />}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {note && <p className="warn de-note">{note}</p>}

            <div className="de-tools">
              <button onClick={addRow}>＋ Row</button>
              <button onClick={addColumn}>＋ Column</button>
              <button onClick={addGroupingRow}>＋ Grouping row</button>
              <span className="de-sep" />
              <button disabled={!canMerge} onClick={mergeSelected}>Merge cells</button>
              <button disabled={!canUnmerge} onClick={unmergeSelected}>Unmerge</button>
              <button disabled={!canDelete} onClick={deleteSelectedColumns}>
                Delete columns</button>
              <label className="de-valuelabel">Value column
                <input type="text" value={valueName}
                  onChange={(e) => setValueName(e.target.value)} />
              </label>
            </div>
    </div>
  );
}
