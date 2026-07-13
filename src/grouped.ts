/* The grouped-sheet lens: project the canonical tidy (long) table into the wide,
   merged-header shape people keep in Excel/Prism. The layout is derived from the
   *hierarchy spine*, not from column types: all but the finest grain level spread
   across the top as nested bands (classifiers hanging off their home level), the
   finest grain runs down the side, and the remaining value columns fill the body.
   This is the *read* half of the lens (long → wide); it is pure and derives the
   whole rendering from the schema + spine + rows, so it never becomes a stored
   form (tidy stays canonical). See
   docs/superpowers/specs/2026-07-13-pivot-across-grain-design.md. */

import type { ColumnDef, Row, Schema, Hierarchy } from "./types";

/* one header cell: a run of `span` leaf columns carrying one group label */
export interface Cell { span: number; label: string }

/* What fixes a grouped rendering, derived from the hierarchy spine:
   - bandCols: the horizontal header levels, outer -> inner. The spine minus its
     finest level, then the classifiers (categoricals not on the spine), which nest
     innermost because a classifier is constant within its home grain.
   - vertical: the finest spine level. Its distinct values index the rows, so body
     cells align across columns (frame 3 is row 3 in every column). null when the
     spine is empty; rows then fall back to the tidy row id (a ragged per-column
     stack, honest because rows are not claimed to align).
   - values: the body columns (everything not on the spine and not a classifier),
     one leaf sub-column each. Zero = a pure index grid. */
export interface GroupedSpec {
  bandCols: ColumnDef[];
  vertical: ColumnDef | null;
  values: ColumnDef[];
}

/* Derive the layout roles from the schema + spine. Pure; needs no rows. Self-heals
   against a spine naming a column the schema no longer has (that level is dropped).
   The keep-order of `schema.columns` is preserved for bands and values, so the view
   is stable and matches the Data-hierarchy panel's ordering. */
export function groupedSpec(schema: Schema, spine: string[]): GroupedSpec {
  const byName = new Map(schema.columns.map((c) => [c.name, c] as const));
  const spineCols = spine
    .map((n) => byName.get(n))
    .filter((c): c is ColumnDef => c != null);
  const spineSet = new Set(spineCols.map((c) => c.name));
  const vertical = spineCols.length ? spineCols[spineCols.length - 1] : null;
  const bandSpine = spineCols.slice(0, Math.max(0, spineCols.length - 1));
  const classifiers = schema.columns.filter(
    (c) => !spineSet.has(c.name) && c.type === "categorical");
  const bandCols = [...bandSpine, ...classifiers];
  const structural = new Set([...spineSet, ...classifiers.map((c) => c.name)]);
  const values = schema.columns.filter((c) => !structural.has(c.name));
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
  values: (string | number | boolean | null)[][];  // [rowIndex][colIndex]
  rowIds: (string | null)[][];                       // parallel to `values`
  nRows: number;
  nCols: number;
}

/* Whether the grouped lens is offered for a table, and if so its layout spec.
   Availability is honest: the view exists iff there is something to lay out — a
   non-empty spine, or at least one categorical to band by. */
export type Availability =
  | { ok: true; spec: GroupedSpec }
  | { ok: false; reason: string };

export function pivotability(schema: Schema | null, hierarchy: Hierarchy): Availability {
  if (!schema) return { ok: false, reason: "No table loaded." };
  const spec = groupedSpec(schema, hierarchy.spine);
  if (spec.bandCols.length === 0 && spec.vertical === null) {
    return {
      ok: false,
      reason: "Nothing to group by. Assign an identifier or a category in the Data hierarchy panel to pivot this table.",
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

  // --- headers: one band row per band level, merging shared prefixes; the leaf row
  // is the value-column label (multi-value) or the innermost band level. ---
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
  // all band levels become band rows; when single-value, the innermost band level
  // is the leaf row instead (so it is not duplicated).
  const bandLevelCount = valueCols.length > 1 ? bandCols.length : Math.max(0, bandCols.length - 1);
  for (let L = 0; L < bandLevelCount; L++) {
    pushBand((g) => cols[g][L], (g) => cols[g].slice(0, L + 1).join(" "));
  }
  // leaf labels + valueOfCol
  const columnLabels: string[] = [];
  const valueOfCol: string[] = [];
  for (let g = 0; g < nGroups; g++) {
    for (let v = 0; v < vPer; v++) {
      const leaf = valueCols.length > 1
        ? valueCols[v].label
        : (bandCols.length ? cols[g][bandCols.length - 1] : (valueCols[0]?.label ?? ""));
      columnLabels.push(leaf);
      valueOfCol.push(valueCols[v]?.name ?? "");
    }
  }

  return {
    spec, bands, columnLabels, valueOfCol,
    factorLabels: bandCols.map((c) => c.label),
    values: values2, rowIds, nRows, nCols,
  };
}
