/* The grouped-sheet lens: project the canonical tidy (long) table into the wide,
   merged-header shape people keep in Excel/Prism. The layout is derived from the
   *identifier spine*: the identifiers become the nested header bands (coarse → fine,
   outer → inner), and every non-identifier column — measures and classifiers alike —
   becomes a leaf column of the little tidy sub-table that hangs under each band
   combination. The sub-tables append horizontally; their rows are stacked as-is
   (ragged), so every record is shown and nothing is ever aligned-and-collapsed.
   This is the *read* half of the lens (long → wide); it is pure and derives the
   whole rendering from the schema + spine + rows, so it never becomes a stored
   form (tidy stays canonical). See
   docs/superpowers/specs/2026-07-13-grouped-sheet-lens-design.md. */

import type { ColumnDef, Row, Schema, Hierarchy } from "./types";

/* one header cell: a run of `span` leaf columns carrying one group label */
export interface Cell { span: number; label: string }

/* What fixes a grouped rendering, derived from the identifier spine:
   - bandCols: the horizontal header levels, outer -> inner — the COARSER identifiers
     (the spine minus its finest level). A classifier is NOT a band; it is a plain
     leaf column, because spreading categoricals across the top is a cross-tab.
   - vertical: the FINEST identifier. It stays vertical — its distinct values index
     the rows, so the sub-tables align across bands (frame 3 is row 3 in every
     block), and it is shown as a single pinned column, coloured as an identifier so
     it reads as a key rather than data. null only when the spine is empty.
   - values: the leaf columns — every non-identifier column (measures and classifiers
     alike), one sub-column each, forming the sub-table under each band combination. */
export interface GroupedSpec {
  bandCols: ColumnDef[];
  vertical: ColumnDef | null;
  values: ColumnDef[];
}

/* Derive the layout roles from the schema + spine. Pure; needs no rows. Self-heals
   against a spine naming a column the schema no longer has (that level is dropped).
   The keep-order of `schema.columns` is preserved for the leaf columns, so the view
   is stable and matches the tidy table's column order. */
export function groupedSpec(schema: Schema, spine: string[]): GroupedSpec {
  const byName = new Map(schema.columns.map((c) => [c.name, c] as const));
  const spineCols = spine
    .map((n) => byName.get(n))
    .filter((c): c is ColumnDef => c != null);
  const spineSet = new Set(spineCols.map((c) => c.name));
  // coarser identifiers -> bands; finest identifier -> the vertical (aligning) axis;
  // every non-identifier -> a leaf column.
  const vertical = spineCols.length ? spineCols[spineCols.length - 1] : null;
  const bandCols = spineCols.slice(0, Math.max(0, spineCols.length - 1));
  const values = schema.columns.filter((c) => !spineSet.has(c.name));
  return { bandCols, vertical, values };
}

/* the materialized wide sheet: merged header + a rectangular value body, holes
   blank. `rowIds` runs parallel to `values` (the tidy row a cell came from) so an
   edit routes back to its row; a blank cell has a null id. `valueOfCol[c]` names
   the value column body column c writes (constant for single-value tables). */
export interface GroupedSheet {
  spec: GroupedSpec;
  bands: Cell[][];          // band levels above the leaf row, outer -> inner
  columnLabels: string[];   // one leaf header per body column
  valueOfCol: string[];     // value-column name per body column (parallel to cols)
  factorLabels: string[];   // display label per band level, for tooltips
  grain: ColumnDef | null;  // the finest identifier — the vertical (pinned) column
  rowLabels: string[];      // the grain value per row (parallel to the row axis)
  values: (string | number | boolean | null)[][];  // [rowIndex][colIndex]
  rowIds: (string | null)[][];                       // parallel to `values`
  nRows: number;
  nCols: number;
}

/* Whether the grouped lens is offered for a table, and if so its layout spec.
   Availability is honest: the view exists iff there is a spine to band by — at
   least one identifier. With none, the wide sheet would be the tidy table with no
   bands, so we refuse and point at the panel rather than render a redundant copy. */
export type Availability =
  | { ok: true; spec: GroupedSpec }
  | { ok: false; reason: string };

export function pivotability(schema: Schema | null, hierarchy: Hierarchy): Availability {
  if (!schema) return { ok: false, reason: "No table loaded." };
  const spec = groupedSpec(schema, hierarchy.spine);
  if (spec.bandCols.length === 0 && spec.vertical === null) {
    return {
      ok: false,
      reason: "Nothing to group by. Mark a column an identifier in the Data hierarchy panel to group the table by it.",
    };
  }
  return { ok: true, spec };
}

/* the value of a band column on a row, as a grouping key (null -> "") */
function levelOf(row: Row, name: string): string {
  const v = row[name];
  return v == null ? "" : String(v);
}

/* The largest dense grid longToWide will build before it's refused. longToWide
   materializes the full nRows x nCols body eagerly (holes and all), *before* the
   windowed renderer trims it — so a near-diagonal pivot (a near-unique column as
   the finest grain: distinct-values rows x one-column-per-group) allocates
   distinct x groups cells, almost all null, and OOMs the renderer tab. Kin to the
   engine's point_cap / facet_cell_cap: an honest refusal, not a silent freeze. */
export const GROUPED_CELL_CAP = 2_000_000;

export interface PivotCost { nRows: number; nCols: number; cells: number }

/* The size of the grid longToWide WOULD allocate, computed without allocating it:
   one O(rows) pass, two Sets — never the O(nRows x nCols) arrays themselves. Mirrors
   longToWide's own dimensioning exactly (band combos x value sub-columns for the
   width; distinct vertical grain values, or the deepest ragged stack, for the
   height) so the guard and the builder can't disagree on the cost. */
export function pivotCost(rows: Row[], spec: GroupedSpec): PivotCost {
  const { bandCols, vertical, values } = spec;
  const bandNames = bandCols.map((c) => c.name);
  const vPer = Math.max(1, values.length);
  const combos = new Set<string>();
  const verticals = new Set<string>();
  const ragged = new Map<string, number>();
  let raggedMax = 0;
  for (const row of rows) {
    const key = bandNames.map((n) => levelOf(row, n)).join(" ");
    combos.add(key);
    if (vertical) {
      verticals.add(levelOf(row, vertical.name));
    } else {
      const n = (ragged.get(key) ?? 0) + 1;
      ragged.set(key, n);
      if (n > raggedMax) raggedMax = n;
    }
  }
  const nCols = combos.size * vPer;
  const nRows = vertical ? (rows.length ? verticals.size : 0) : raggedMax;
  return { nRows, nCols, cells: nRows * nCols };
}

/* legible refusal when a pivot exceeds GROUPED_CELL_CAP, else null. Names the
   finest grain and its cardinality, because the usual cause is a measurement column
   mis-marked an identifier (which makes it the finest grain) — the same value-under-
   test-as-a-key mistake the figure guards already block, surfaced here for the lens. */
export function pivotOverflow(rows: Row[], spec: GroupedSpec): { cost: PivotCost; reason: string } | null {
  const cost = pivotCost(rows, spec);
  if (cost.cells <= GROUPED_CELL_CAP) return null;
  const dims = `${cost.nCols.toLocaleString()} × ${cost.nRows.toLocaleString()}`;
  const grain = spec.vertical;
  const reason = grain
    ? `This pivot is too large to lay out — ${dims} = ${cost.cells.toLocaleString()} cells. ` +
      `“${grain.label}” is the finest grain and has ${cost.nRows.toLocaleString()} distinct values, so every ` +
      `value becomes its own row and every group its own column. If “${grain.label}” is a measurement, mark it ` +
      `a measure (not an identifier) in the Data hierarchy panel; otherwise pick a coarser grain.`
    : `This pivot is too large to lay out — ${dims} = ${cost.cells.toLocaleString()} cells. ` +
      `Group by fewer or coarser levels.`;
  return { cost, reason };
}

/* long -> wide, aligned by the vertical grain. Pure: no engine, no fetch.
   Columns = distinct band combinations (ordered so bands nest cleanly), each
   expanded by the value columns. Rows = the vertical grain's distinct values in
   first-seen order (holes where a column lacks that grain value); with no vertical
   axis, rows are a ragged per-column stack. */
export function longToWide(rows: Row[], spec: GroupedSpec): GroupedSheet {
  const { bandCols, vertical, values } = spec;
  const bandNames = bandCols.map((c) => c.name);
  const valueCols = values.length ? values : [];
  const vPer = Math.max(1, valueCols.length);   // leaf sub-columns per group

  // --- group rows by band combination, tracking first-seen level order ---
  const levelOrder: Map<string, number>[] = bandCols.map(() => new Map());
  const combos = new Map<string, string[]>();
  const bucket = new Map<string, Row[]>();
  for (const row of rows) {
    const combo = bandNames.map((n) => levelOf(row, n));
    combo.forEach((lv, f) => {
      if (!levelOrder[f].has(lv)) levelOrder[f].set(lv, levelOrder[f].size);
    });
    const key = combo.join(" ");
    if (!combos.has(key)) { combos.set(key, combo); bucket.set(key, []); }
    bucket.get(key)!.push(row);
  }
  const comboKeys = [...combos.keys()].sort((ka, kb) => {
    const a = combos.get(ka)!, b = combos.get(kb)!;
    for (let f = 0; f < bandCols.length; f++) {
      const d = levelOrder[f].get(a[f])! - levelOrder[f].get(b[f])!;
      if (d) return d;
    }
    return 0;
  });

  // --- row order: the vertical grain's first-seen values, else positional ---
  const rowKeyOf = (row: Row): string =>
    vertical ? levelOf(row, vertical.name) : (row.id ?? "");
  const rowOrder = new Map<string, number>();
  if (vertical) {
    for (const row of rows) {
      const k = rowKeyOf(row);
      if (!rowOrder.has(k)) rowOrder.set(k, rowOrder.size);
    }
  }
  // per-group index of a row: aligned by grain, or positional (ragged) when no axis
  const posInGroup = new Map<string, number>();   // key -> running count (ragged)
  const rowIndexOf = (key: string, row: Row): number => {
    if (vertical) return rowOrder.get(rowKeyOf(row))!;
    const n = posInGroup.get(key) ?? 0;
    posInGroup.set(key, n + 1);
    return n;
  };

  const nGroups = comboKeys.length;
  const nCols = nGroups * vPer;
  // nRows: distinct grain values (aligned) or the deepest ragged stack
  let nRows = 0;
  if (vertical) {
    nRows = rows.length ? rowOrder.size : 0;
  } else {
    for (const key of comboKeys) nRows = Math.max(nRows, bucket.get(key)!.length);
  }

  const values2: (string | number | boolean | null)[][] =
    Array.from({ length: nRows }, () => Array<string | number | boolean | null>(nCols).fill(null));
  const rowIds: (string | null)[][] =
    Array.from({ length: nRows }, () => Array<string | null>(nCols).fill(null));

  comboKeys.forEach((key, g) => {
    for (const row of bucket.get(key)!) {
      const r = rowIndexOf(key, row);
      for (let v = 0; v < vPer; v++) {
        const c = g * vPer + v;
        const vc = valueCols[v];
        values2[r][c] = vc ? (row[vc.name] ?? null) : null;
        rowIds[r][c] = row.id ?? null;
      }
    }
  });

  // --- headers: one band row per band level (the coarser identifiers), merging
  // shared prefixes; the leaf row is always the value-column label. The finest
  // identifier is NOT a band — it is the vertical grain column (below). ---
  const cols = comboKeys.map((k) => combos.get(k)!);
  const bands: Cell[][] = [];
  const pushBand = (labelAt: (g: number) => string, prefixLen: (g: number) => string) => {
    const band: Cell[] = [];
    for (let g = 0; g < nGroups; g++) {
      const same = g > 0 && prefixLen(g) === prefixLen(g - 1);
      const label = labelAt(g);
      for (let v = 0; v < vPer; v++) {
        const merge = same || v > 0;
        if (merge) band[band.length - 1].span += 1;
        else band.push({ span: 1, label });
      }
    }
    bands.push(band);
  };
  for (let L = 0; L < bandCols.length; L++) {
    pushBand((g) => cols[g][L], (g) => cols[g].slice(0, L + 1).join(" "));
  }
  // leaf labels + valueOfCol — always the value column's own label
  const columnLabels: string[] = [];
  const valueOfCol: string[] = [];
  for (let g = 0; g < nGroups; g++) {
    for (let v = 0; v < vPer; v++) {
      columnLabels.push(valueCols[v]?.label ?? "");
      valueOfCol.push(valueCols[v]?.name ?? "");
    }
  }

  // the vertical grain's value per row, for the pinned identifier column (aligned
  // mode). Positional 1-based labels when there is no grain axis (ragged fallback).
  const rowLabels: string[] = new Array(nRows).fill("");
  if (vertical) for (const [k, i] of rowOrder) rowLabels[i] = k;
  else for (let i = 0; i < nRows; i++) rowLabels[i] = String(i + 1);

  return {
    spec, bands, columnLabels, valueOfCol,
    factorLabels: bandCols.map((c) => c.label),
    grain: vertical, rowLabels,
    values: values2, rowIds, nRows, nCols,
  };
}
