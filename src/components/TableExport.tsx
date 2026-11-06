import { useState } from "react";
import { useAtomValue } from "jotai";
import { activeHandleAtom, activeTableAtom } from "../state";
import { engine, type Row, type ColumnDef } from "../types";

/* Copy a whole table to the clipboard (tab-separated, pastes into a spreadsheet
   as columns) or download it as CSV. The grids are ag-grids without range
   selection, and on a touch screen a multi-cell selection is a long-press away
   even in the grouped sheet, so every table is one tap from a spreadsheet: the
   Data pane's table and each Workbench node's table. Header = column labels;
   missing values are blank. */

type Cell = Row[string];

function textOf(v: Cell | undefined): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isNaN(v)) return "";
  return String(v);
}

export function tableToTSV(columns: ColumnDef[], rows: Row[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  const lines = [columns.map((c) => clean(c.label || c.name)).join("\t")];
  for (const r of rows) lines.push(columns.map((c) => clean(textOf(r[c.name]))).join("\t"));
  return lines.join("\n") + "\n";
}

export function tableToCSV(columns: ColumnDef[], rows: Row[]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [columns.map((c) => q(c.label || c.name)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => q(textOf(r[c.name]))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/* a file name from a table or node label: letters, digits, dot, dash */
export function csvName(label: string): string {
  const s = label.trim().replace(/[^\p{L}\p{N}.-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${s || "iris-table"}.csv`;
}

/* The two buttons. `load` returns every row (it may fetch); `n` is the row count
   shown in the confirmation. */
export function ExportButtons({ columns, n, load, filename }: {
  columns: ColumnDef[]; n: number; load: () => Promise<Row[]>; filename: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const flash = (s: string) => { setNote(s); window.setTimeout(() => setNote(null), 1800); };

  const copy = async () => {
    const text = load().then((rows) => tableToTSV(columns, rows));
    try {
      // Safari only lets a clipboard write follow a tap synchronously: hand it a
      // ClipboardItem whose content is still loading rather than awaiting first
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })),
        })]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      flash(`Copied ${n.toLocaleString()} rows`);
    } catch {
      flash("Copy failed — use CSV");
    }
  };

  const download = async () => {
    try {
      const csv = tableToCSV(columns, await load());
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      flash("Export failed");
    }
  };

  return (
    <div className="seg tx-export">
      <button title="Copy the whole table, tab-separated, to paste into a spreadsheet" onClick={() => void copy()}>Copy table</button>
      <button title="Download the whole table as CSV" onClick={() => void download()}>CSV</button>
      {note && <span className="tx-note" role="status">{note}</span>}
    </div>
  );
}

/* the Data pane's table: the active table, fetched whole */
export function TableExport() {
  const handle = useAtomValue(activeHandleAtom);
  const table = useAtomValue(activeTableAtom);
  if (!handle) return null;
  return (
    <ExportButtons columns={handle.schema.columns} n={handle.n} filename={csvName(table?.name ?? "")}
      load={async () => (await engine.rowsWindow(handle.id, 0, handle.n)).rows} />
  );
}
