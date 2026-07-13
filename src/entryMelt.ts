import { fileToBase64 } from "./types";

/* Pure helpers for the tidy entry grid: the fresh-sheet defaults and the melt that
   turns its nested wide layout into an import request (one categorical column per
   band level + a value column). Kept free of React/atoms so the mint action
   (state.ts) and the DataEntry component can share them without a cycle. */

export interface EntryCell {
  span: number;
  label: string;
}

export const START_ROWS = 8;

/* the default sheet: two flat conditions, no grouping — the layout most people
   reach for. Bands are added on demand. */
export const freshColumns = (): string[] => ["Control", "Treatment"];
export const freshRows = (nCols: number): string[][] =>
  Array.from({ length: START_ROWS }, () => Array(nCols).fill(""));

/* index of the cell covering column `col` in a band row */
export function coverAt(row: EntryCell[], col: number): number {
  let a = 0;
  for (let i = 0; i < row.length; i++) { a += row[i].span; if (col < a) return i; }
  return Math.max(0, row.length - 1);
}

/* auto-names for the categorical columns the header levels melt into. People rarely
   care what these are called (they can rename after), so the flat case gets the
   domain-obvious "condition" and nested cases get generic band names. */
export function levelNames(depth: number): string[] {
  if (depth <= 1) return ["condition"];
  const base = ["group", "subgroup", "subsubgroup"];
  return Array.from({ length: depth }, (_, i) => base[i] ?? `level_${i + 1}`);
}

/* a leaf column's full chain of labels, coarse → fine, incl. its own header */
export function pathOf(bands: EntryCell[][], columnLabels: string[], c: number): string[] {
  return [...bands.map((row) => row[coverAt(row, c)].label), columnLabels[c]];
}

/* melt the wide entry sheet into an import request: a synthetic CSV with unique
   headers (c0…cN) so repeated leaf labels never collide, plus a `groups` map
   carrying the header hierarchy. Reuses the import pipeline so parsing, decimal
   commas, and type inference come for free. Pure — the caller runs the import. */
export function buildEntryImport(
  bands: EntryCell[][], columns: string[], rows: string[][], valueName: string,
) {
  const headers = columns.map((_, i) => `c${i}`);
  const scrub = (s: string) => s.replace(/[;\n"]/g, " ").trim();
  const lines = [headers.join(";")];
  for (let r = 0; r < rows.length; r++) {
    const cells = headers.map((_, c) => scrub(rows[r]?.[c] ?? ""));
    if (cells.some(Boolean)) lines.push(cells.join(";"));
  }
  const b64 = fileToBase64(new TextEncoder().encode(lines.join("\n")).buffer as ArrayBuffer);

  const names = levelNames(bands.length + 1);
  const groups: Record<string, string[]> = {};
  columns.forEach((_, i) => {
    groups[headers[i]] = pathOf(bands, columns, i)
      .map((s, k) => s.trim() || `${names[k]}_${k + 1}`);
  });

  return {
    src: { filename: "entered.csv", data_base64: b64 },
    opts: {
      delimiter: ";",
      reshape: {
        value_columns: headers,
        value_name: valueName.trim() || "Value",
        level_names: names,
        groups,
      },
    },
  };
}
