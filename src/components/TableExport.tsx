import { useState } from "react";
import { useAtomValue } from "jotai";
import { activeHandleAtom } from "../state";
import { engine, type Row, type Schema } from "../types";

/* Copy the whole active table to the clipboard (tab-separated, pastes into a
   spreadsheet as columns) or download it as CSV. The Table view is an ag-grid
   without range selection, and on a touch screen a multi-cell selection is a
   long-press away even in the grouped sheet, so the whole table is always one tap
   from a spreadsheet. Header = column labels; missing values are blank. */

type Cell = Row[string];

function textOf(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isNaN(v)) return "";
  return String(v);
}

export function tableToTSV(schema: Schema, rows: Row[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  const lines = [schema.columns.map((c) => clean(c.label || c.name)).join("\t")];
  for (const r of rows) lines.push(schema.columns.map((c) => clean(textOf(r[c.name]))).join("\t"));
  return lines.join("\n") + "\n";
}

export function tableToCSV(schema: Schema, rows: Row[]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [schema.columns.map((c) => q(c.label || c.name)).join(",")];
  for (const r of rows) lines.push(schema.columns.map((c) => q(textOf(r[c.name]))).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function TableExport() {
  const handle = useAtomValue(activeHandleAtom);
  const [note, setNote] = useState<string | null>(null);
  if (!handle) return null;

  const flash = (s: string) => { setNote(s); window.setTimeout(() => setNote(null), 1800); };
  const allRows = async () => (await engine.rowsWindow(handle.id, 0, handle.n)).rows;

  const copy = async () => {
    const text = allRows().then((rows) => tableToTSV(handle.schema, rows));
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
      flash(`Copied ${handle.n} rows`);
    } catch {
      flash("Copy failed — use CSV");
    }
  };

  const download = async () => {
    try {
      const csv = tableToCSV(handle.schema, await allRows());
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = "iris-table.csv";
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
