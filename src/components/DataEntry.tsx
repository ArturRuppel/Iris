import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useSetAtom } from "jotai";
import { loadTableAtom } from "../state";
import { engine, fileToBase64, tableFromColumnar } from "../types";

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
interface Cell { span: number; label: string }
/* a run of adjacent cells [a..b] in one header row; `row` is a band level, or
   `bands.length` for the value-column row */
interface Sel { row: number; a: number; b: number }

const START_ROWS = 8;

/* the default sheet: two flat conditions, no grouping — the layout most people
   reach for. Bands are added on demand. */
const freshColumns = (): string[] => ["Control", "Treatment"];
const freshRows = (nCols: number): string[][] =>
  Array.from({ length: START_ROWS }, () => Array(nCols).fill(""));

/* Auto-names for the categorical columns the header levels melt into. People
   rarely care what these are called (they can rename after), so the flat case
   gets the domain-obvious "condition" and nested cases get generic band names. */
function levelNames(depth: number): string[] {
  if (depth <= 1) return ["condition"];
  const base = ["group", "subgroup", "subsubgroup"];
  return Array.from({ length: depth }, (_, i) => base[i] ?? `level_${i + 1}`);
}

/* ---- pure header helpers (operate on band rows) ---- */

/* starting column index of each cell in a band row */
function starts(row: Cell[]): number[] {
  const s: number[] = [];
  let a = 0;
  for (const c of row) { s.push(a); a += c.span; }
  return s;
}
/* index of the cell covering column `col` */
function coverAt(row: Cell[], col: number): number {
  let a = 0;
  for (let i = 0; i < row.length; i++) { a += row[i].span; if (col < a) return i; }
  return Math.max(0, row.length - 1);
}
/* the atomic column partition — the finest level, sitting below the last band */
function colCells(nCols: number): Cell[] {
  return Array.from({ length: nCols }, () => ({ span: 1, label: "" }));
}
/* a leaf column's full chain of labels, coarse → fine, incl. its own header */
function pathOf(bands: Cell[][], columnLabels: string[], c: number): string[] {
  return [...bands.map((row) => row[coverAt(row, c)].label), columnLabels[c]];
}
/* collapse cells [a..b] of a band row into one (first non-blank label wins) */
function mergeRange(row: Cell[], a: number, b: number): Cell[] {
  const merged: Cell = {
    span: row.slice(a, b + 1).reduce((s, c) => s + c.span, 0),
    label: row.slice(a, b + 1).map((c) => c.label).find((l) => l.trim()) ?? "",
  };
  return [...row.slice(0, a), merged, ...row.slice(b + 1)];
}
/* drop `count` columns starting at `startCol` from a band row, keeping spans in
   sync and dropping any cell emptied by the cut */
function shrinkBand(row: Cell[], startCol: number, count: number): Cell[] {
  const end = startCol + count;
  const out: Cell[] = [];
  let s = 0;
  for (const cell of row) {
    const overlap = Math.max(0, Math.min(s + cell.span, end) - Math.max(s, startCol));
    if (cell.span - overlap > 0) out.push({ ...cell, span: cell.span - overlap });
    s += cell.span;
  }
  return out;
}

/** "Enter data": a spreadsheet with nested, merged headers — the wide grouped
 *  layout people keep in their heads and their Excel sheets (repeating columns
 *  under a merged grouping band, nestable to any depth). Type or paste like a
 *  spreadsheet; on create the engine melts the header hierarchy into a tidy
 *  table (one categorical column per band level + one value column), reusing the
 *  import pipeline so parsing, decimal commas, and type inference come for free.
 *
 *  Rendered *inline* as the empty state of the grouped-sheet lens (Slice 5): with
 *  no table loaded, the grouped pane IS this entry surface, and Create mints the
 *  session — the moment a handle exists GroupedSheet unmounts this and shows the
 *  live lens. Entry and lens are one continuous surface, one write path. */
export function DataEntry() {
  const loadTable = useSetAtom(loadTableAtom);
  const [bands, setBands] = useState<Cell[][]>([]);
  const [columnLabels, setColumnLabels] = useState<string[]>(freshColumns);
  const [rows, setRows] = useState<string[][]>(() => freshRows(2));
  const [sel, setSel] = useState<Sel | null>(null);
  const [valueName, setValueName] = useState("Value");
  const [error, setError] = useState<string | null>(null);   // create failures (footer)
  const [note, setNote] = useState<string | null>(null);      // refused-action explanation
  const [busy, setBusy] = useState(false);

  const nCols = columnLabels.length;
  const depth = bands.length + 1;
  const cell = (r: number, c: number) => rows[r]?.[c] ?? "";

  const reset = () => {
    setBands([]);
    setColumnLabels(freshColumns());
    setRows(freshRows(2));
    setValueName("Value");
    setSel(null); setNote(null);
  };

  /* ---- selection ---- */
  /* the row a selection points at (a band, or the value columns) */
  const selRow = (s: Sel): Cell[] => (s.row < bands.length ? bands[s.row] : colCells(nCols));
  /* the value-column range [first, last] a selection covers */
  const selCols = (): [number, number] | null => {
    if (!sel) return null;
    const row = selRow(sel), st = starts(row);
    if (sel.b >= row.length) return null;   // stale (structure changed) — ignore
    return [st[sel.a], st[sel.b] + row[sel.b].span - 1];
  };
  const pick = (row: number, i: number, shift: boolean) => {
    setNote(null);
    setSel((prev) => (shift && prev && prev.row === row
      ? { row, a: Math.min(prev.a, i), b: Math.max(prev.b, i) }
      : { row, a: i, b: i }));
  };
  const colSelected = (c: number): boolean => {
    const r = selCols();
    return !!r && c >= r[0] && c <= r[1];
  };
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

  /* spill a pasted TSV/CSV block across cells starting at (r0,c0), growing rows
     (and columns, joining the rightmost group) to fit — the Excel paste. */
  const spill = (r0: number, c0: number, text: string) => {
    const grid = text.replace(/\r/g, "").replace(/\n+$/, "")
      .split("\n").map((line) => line.split("\t"));
    const need = c0 + Math.max(...grid.map((g) => g.length));
    if (need > nCols) addColumns(need - nCols);
    setRows((rs) => {
      const width = Math.max(nCols, need);
      const next = rs.map((row) => {
        const cp = row.slice();
        while (cp.length < width) cp.push("");
        return cp;
      });
      grid.forEach((line, dr) => {
        const r = r0 + dr;
        while (next.length <= r) next.push(Array(width).fill(""));
        line.forEach((val, dc) => { next[r][c0 + dc] = val.trim(); });
      });
      return next;
    });
  };
  const onPaste = (r: number, c: number) => (e: ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text)) return;   // a single cell — let the input handle it
    e.preventDefault();
    spill(r, c, text);
  };
  /* Enter walks down a column (adding a row at the bottom), the spreadsheet feel. */
  const onKey = (r: number, c: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (r + 1 >= rows.length) addRow();
    focusCell(r + 1, c);
  };
  const focusCell = (r: number, c: number) =>
    queueMicrotask(() =>
      document.querySelector<HTMLInputElement>(`[data-cell="${r}:${c}"]`)?.focus());

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
  /* "+ Column": add one, into the selected group if there is a selection. */
  const addColumn = () => { const r = selCols(); addColumns(1, r ? r[1] : nCols - 1); };

  const renameCell = (level: number, i: number, v: string) =>
    setBands((bs) => bs.map((row, L) =>
      (L === level ? row.map((c, k) => (k === i ? { ...c, label: v } : c)) : row)));
  const renameColumn = (c: number, v: string) =>
    setColumnLabels((ls) => ls.map((l, i) => (i === c ? v : l)));

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

  const delRange = selCols();
  const canDelete = !!delRange && (delRange[1] - delRange[0] + 1) < nCols;
  const deleteSelectedColumns = () => {
    if (!canDelete || !delRange) return;
    const [s, e] = delRange, count = e - s + 1;
    setBands((bs) => bs.map((row) => shrinkBand(row, s, count)));
    setColumnLabels((ls) => ls.filter((_, i) => i < s || i > e));
    setRows((rs) => rs.map((row) => row.filter((_, i) => i < s || i > e)));
    setSel(null); setNote(null);
  };

  /* ---- create ---- */
  const filledCols = columnLabels
    .map((_, c) => rows.some((row) => (row[c] ?? "").trim())).filter(Boolean).length;
  const nValues = rows.reduce((a, row) =>
    a + row.slice(0, nCols).filter((v) => v.trim()).length, 0);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      /* synthetic unique headers (c0…cN) so repeated leaf labels — "Day 1"
         under both Control and Treatment — never collide; the header hierarchy
         travels in `groups`, not in the CSV header. */
      const headers = columnLabels.map((_, i) => `c${i}`);
      const scrub = (s: string) => s.replace(/[;\n"]/g, " ").trim();
      const lines = [headers.join(";")];
      for (let r = 0; r < rows.length; r++) {
        const cells = headers.map((_, c) => scrub(cell(r, c)));
        if (cells.some(Boolean)) lines.push(cells.join(";"));
      }
      const b64 = fileToBase64(
        new TextEncoder().encode(lines.join("\n")).buffer as ArrayBuffer);

      const names = levelNames(depth);
      const groups: Record<string, string[]> = {};
      columnLabels.forEach((_, i) => {
        groups[headers[i]] = pathOf(bands, columnLabels, i)
          .map((s, k) => s.trim() || `${names[k]}_${k + 1}`);
      });

      const src = { filename: "entered.csv", data_base64: b64 };
      const opts = {
        delimiter: ";",
        reshape: {
          value_columns: headers,
          value_name: valueName.trim() || "Value",
          level_names: names,
          groups,
        },
      };
      const long = await engine.importPreview(src, opts);
      const ct = await engine.importCommit(src, opts,
        long.columns.map((c) => ({ name: c.name, label: c.label, type: c.type })));
      loadTable({ ...tableFromColumnar(ct), token: ct.token });
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const colRow = bands.length;   // the value-column row's index in the selection model

  return (
    <div className="de-inline">
            <p className="de-hint">
              Type or paste your data — replicates run down, conditions across.
              Add grouping rows to nest conditions; on create this melts to one
              tidy table.
            </p>

            <div className="de-scroll">
              <table className="de-grid">
                <thead>
                  {bands.map((row, level) => (
                    <tr key={`b${level}`} className="de-band">
                      <th className="de-corner">
                        <button className="de-icon" title="delete grouping row"
                          onClick={() => removeBand(level)}>✕</button>
                      </th>
                      {row.map((c, i) => (
                        <th key={i} colSpan={c.span}
                          className={`de-groupcell${cellSelected(level, i) ? " de-sel" : ""}`}
                          onClick={(e) => pick(level, i, e.shiftKey)}>
                          <div className="de-grouphead">
                            <input value={c.label} spellCheck={false}
                              placeholder="group"
                              onChange={(e) => renameCell(level, i, e.target.value)} />
                          </div>
                        </th>
                      ))}
                      {level === 0 && <th className="de-addcol" rowSpan={depth} />}
                    </tr>
                  ))}
                  <tr className="de-heads">
                    <th className="de-corner">#</th>
                    {columnLabels.map((label, c) => (
                      <th key={c}
                        className={`de-colcell${colSelected(c) ? " de-sel" : ""}`}
                        onClick={(e) => pick(colRow, c, e.shiftKey)}>
                        <div className="de-colhead">
                          <input value={label} spellCheck={false}
                            placeholder="column"
                            onChange={(e) => renameColumn(c, e.target.value)} />
                        </div>
                      </th>
                    ))}
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
                      {columnLabels.map((_, c) => (
                        <td key={c} className={colSelected(c) ? "de-selcol" : undefined}>
                          <input className="de-cell" data-cell={`${r}:${c}`}
                            value={cell(r, c)} spellCheck={false}
                            onChange={(e) => setCell(r, c, e.target.value)}
                            onPaste={onPaste(r, c)} onKeyDown={onKey(r, c)} />
                        </td>
                      ))}
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

            {error && <p className="warn">{error}</p>}
            <div className="de-foot">
              <button className="primary"
                disabled={busy || filledCols < 2}
                onClick={() => void create()}>
                {busy ? "Working…" : `Create table (${nValues} values)`}
              </button>
            </div>
    </div>
  );
}
