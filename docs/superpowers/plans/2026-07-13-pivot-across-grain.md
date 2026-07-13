# Pivot Across the Grain (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the grouped-sheet lens so it derives its layout from the hierarchy spine (an aligned pivot), making it available and correct on real per-object tables instead of only small single-value ones.

**Architecture:** Replace `grouped.ts`'s `{value, factors}` model (one numeric value, categorical factors, ragged replicate stack) with a spine-driven model: horizontal bands = `spine[0..n-2]` + classifiers, the vertical axis = the finest spine level (rows align by its value), the body = the remaining value columns. `pivotability` reads the `Hierarchy` instead of counting numeric columns; the row cap and one-value rule are dropped. `GroupedSheet.tsx` is wired to `activeHierarchyAtom` and its per-cell edit carries the value column it belongs to. Tidy stays canonical; every edit is still one `engine.editCell`.

**Tech Stack:** TypeScript, React, Jotai, Vitest (unit), Playwright (e2e). Pure logic in `src/grouped.ts`; UI in `src/components/GroupedSheet.tsx`.

**Spec:** `docs/superpowers/specs/2026-07-13-pivot-across-grain-design.md`

**Key decisions locked in (from brainstorming):**
- Vertical axis = the last spine level. Reordering the spine (a follow-up slice) re-picks it.
- Classifiers (categoricals not on the spine) become the innermost band levels.
- Value columns = every column not on the spine and not a classifier; each is a leaf sub-column. Zero value columns = a pure index grid.
- No spine but ≥1 categorical: vertical falls back to the tidy row `id`, giving a ragged per-column stack (honest: rows are not claimed to align).
- Caps: `MAX_GROUPED_ROWS` is deleted; `MAX_GROUPED_COLS` is retained as a soft ceiling only until virtualisation lands (follow-up slice), so a real table is not silently blocked. See Task 6.

---

## File Structure

- `src/grouped.ts` — MODIFY. New `GroupedSpec`, new `groupedSpec()` deriver, new `pivotability()` signature, rewritten `longToWide()`. `applyFactorOrder` is removed (nesting moves to the spine in a follow-up slice; nothing in Slice 1 needs it).
- `src/grouped.test.ts` — MODIFY. Old `{value, factors}` cases replaced by spine-based cases.
- `src/components/GroupedSheet.tsx` — MODIFY. Read `activeHierarchyAtom`, pass the hierarchy to `pivotability`, consume the new spec shape, carry the value column per body cell, drop the deleted cap.
- `src/state.test.ts` — MODIFY (append). One persistence round-trip regression test.

No new files. The lens stays two files plus their tests.

---

## Task 1: New spec shape and the spine deriver

**Files:**
- Modify: `src/grouped.ts:15-52` (types + constants)
- Test: `src/grouped.test.ts`

The deriver is the heart of the model: schema + spine in, layout roles out. Pure, no rows needed.

- [ ] **Step 1: Write the failing tests**

Add to `src/grouped.test.ts`. Replace the existing top imports and helpers with these (they are reused by every later task), then add the `groupedSpec` block:

```ts
import { describe, it, expect } from "vitest";
import {
  pivotability, groupedSpec, longToWide, type GroupedSpec,
} from "./grouped";
import type { ColumnDef, Row, Schema, Hierarchy } from "./types";

const col = (name: string, type: ColumnDef["type"]): ColumnDef =>
  ({ name, type, label: name });
const schema = (...cs: ColumnDef[]): Schema => ({ schema_version: "1.0", columns: cs });
const hier = (...spine: string[]): Hierarchy => ({ spine, fn: {} });

// cell_size, correctly typed: experiment/position/cell/frame are the grain,
// subpopulation labels it, value is the measurement.
const cellSizeSchema = schema(
  col("experiment_id", "identifier"), col("position_id", "identifier"),
  col("cell_id", "identifier"), col("frame", "identifier"),
  col("subpopulation", "categorical"), col("value", "numeric"),
);
const cellSizeSpine = hier("experiment_id", "position_id", "cell_id", "frame");

describe("groupedSpec — layout roles from the spine", () => {
  it("bands = spine minus finest, plus classifiers; vertical = finest; body = the rest", () => {
    const s = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    expect(s.bandCols.map((c) => c.name)).toEqual(
      ["experiment_id", "position_id", "cell_id", "subpopulation"]);
    expect(s.vertical?.name).toBe("frame");
    expect(s.values.map((c) => c.name)).toEqual(["value"]);
  });

  it("a spineless table with a categorical bands by it, vertical falls back to null (row id)", () => {
    const s = groupedSpec(
      schema(col("contact_type", "categorical"), col("value", "numeric")), []);
    expect(s.bandCols.map((c) => c.name)).toEqual(["contact_type"]);
    expect(s.vertical).toBeNull();
    expect(s.values.map((c) => c.name)).toEqual(["value"]);
  });

  it("multiple non-structural numerics are all value columns", () => {
    const s = groupedSpec(
      schema(col("experiment_id", "identifier"), col("focal", "categorical"),
             col("obs", "numeric"), col("exp", "numeric")),
      ["experiment_id"]);
    expect(s.vertical?.name).toBe("experiment_id");
    expect(s.bandCols.map((c) => c.name)).toEqual(["focal"]);
    expect(s.values.map((c) => c.name)).toEqual(["obs", "exp"]);
  });

  it("a spine level absent from the schema is skipped (self-healing)", () => {
    const s = groupedSpec(
      schema(col("a", "identifier"), col("v", "numeric")), ["a", "gone"]);
    expect(s.vertical?.name).toBe("a");
    expect(s.bandCols).toEqual([]);
    expect(s.values.map((c) => c.name)).toEqual(["v"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/grouped.test.ts -t groupedSpec`
Expected: FAIL — `groupedSpec is not a function` (and the `GroupedSpec` import fails to resolve its new shape).

- [ ] **Step 3: Replace the type block and add the deriver**

In `src/grouped.ts`, replace lines 15-52 (from `/* one header cell` through the `MAX_GROUPED_COLS` declaration) with:

```ts
import type { ColumnDef, Row, Schema } from "./types";

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
```

Note: the `Availability` type, `pivotability`, `applyFactorOrder`, `levelOf`, and `longToWide` below still reference the old model and will not compile yet. Tasks 2 and 3 replace them. That is expected mid-refactor; the whole file compiles again after Task 3.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/grouped.test.ts -t groupedSpec`
Expected: PASS (4 tests). Type errors elsewhere in `grouped.ts` are fine until Task 3; vitest transpiles per-file.

- [ ] **Step 5: Commit**

```bash
git add src/grouped.ts src/grouped.test.ts
git commit -m "feat(grouped): derive layout roles from the hierarchy spine (pivot-across-grain slice 1)"
```

---

## Task 2: Availability from the spine

**Files:**
- Modify: `src/grouped.ts` (the `Availability` type + `pivotability`)
- Test: `src/grouped.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire existing `describe("pivotability predicate", ...)` block in `src/grouped.test.ts` with:

```ts
describe("pivotability — availability from the spine", () => {
  it("a non-empty spine is pivotable", () => {
    const a = pivotability(cellSizeSchema, cellSizeSpine);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.spec.vertical?.name).toBe("frame");
  });

  it("no spine but a categorical is pivotable (id fallback)", () => {
    const a = pivotability(
      schema(col("contact_type", "categorical"), col("value", "numeric")), hier());
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.spec.vertical).toBeNull();
  });

  it("no structure at all is not pivotable, with an honest reason", () => {
    const a = pivotability(schema(col("value", "numeric")), hier());
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(/group by/i);
  });

  it("no schema is not pivotable", () => {
    const a = pivotability(null, hier());
    expect(a.ok).toBe(false);
  });

  it("many rows are fine — there is no row cap", () => {
    const a = pivotability(cellSizeSchema, cellSizeSpine);
    expect(a.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/grouped.test.ts -t pivotability`
Expected: FAIL — `pivotability` still has the old `(schema, n)` signature and reads numeric counts.

- [ ] **Step 3: Replace the availability type and predicate**

In `src/grouped.ts`, replace the `Availability` type block and the whole `pivotability` function (old lines ~37-82) with:

```ts
import type { Hierarchy } from "./types";

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
```

Add `Hierarchy` to the existing type import at the top of the file rather than a second `import` line if you prefer; either compiles. Delete the now-unused `MAX_GROUPED_ROWS` export and the `applyFactorOrder` function and its doc comment (nothing in Slice 1 uses them; `GroupedSheet` stops importing them in Task 5).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/grouped.test.ts -t pivotability`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/grouped.ts src/grouped.test.ts
git commit -m "feat(grouped): availability reads the spine, no row cap (slice 1)"
```

---

## Task 3: Rewrite `longToWide` as an aligned pivot

**Files:**
- Modify: `src/grouped.ts` (`GroupedSheet` interface + `longToWide`, `levelOf`)
- Test: `src/grouped.test.ts`

This is the crux. The `GroupedSheet` interface grows a `valueOfCol` parallel array so a body cell edit knows which value column it writes (needed for multi-value; harmless for single-value). Rows are indexed by the vertical grain when present.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe("longToWide", ...)` block(s) in `src/grouped.test.ts` with:

```ts
const rid = (id: string, o: Record<string, unknown>): Row => ({ id, ...o } as Row);

describe("longToWide — aligned pivot on the spine", () => {
  it("aligns rows by the vertical grain across columns", () => {
    // two cells, one per band column; frame is the vertical axis
    const spec = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    const rows: Row[] = [
      rid("1", { experiment_id: "E1", position_id: "P1", cell_id: "c1", frame: 0, subpopulation: "KO", value: 10 }),
      rid("2", { experiment_id: "E1", position_id: "P1", cell_id: "c1", frame: 1, subpopulation: "KO", value: 11 }),
      rid("3", { experiment_id: "E1", position_id: "P1", cell_id: "c2", frame: 1, subpopulation: "WT", value: 20 }),
    ];
    const sheet = longToWide(rows, spec);
    expect(sheet.nCols).toBe(2);           // c1, c2
    expect(sheet.nRows).toBe(2);           // frames {0, 1}
    // c1 has frames 0 and 1; c2 has only frame 1 -> a hole at row 0 (frame 0)
    expect(sheet.values[0]).toEqual([10, null]);   // frame 0
    expect(sheet.values[1]).toEqual([11, 20]);     // frame 1
    // the hole carries no id, so it is not editable
    expect(sheet.rowIds[0]).toEqual(["1", null]);
    expect(sheet.rowIds[1]).toEqual(["2", "3"]);
  });

  it("carries the value column for each body column (single value)", () => {
    const spec = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    const rows: Row[] = [
      rid("1", { experiment_id: "E1", position_id: "P1", cell_id: "c1", frame: 0, subpopulation: "KO", value: 10 }),
    ];
    const sheet = longToWide(rows, spec);
    expect(sheet.valueOfCol).toEqual(["value"]);
  });

  it("multiple value columns become adjacent leaf sub-columns per group", () => {
    const s = schema(col("experiment_id", "identifier"), col("focal", "categorical"),
                     col("obs", "numeric"), col("exp", "numeric"));
    const spec = groupedSpec(s, ["experiment_id"]);   // vertical = experiment_id
    const rows: Row[] = [
      rid("1", { experiment_id: "E1", focal: "neg", obs: 3, exp: 2.5 }),
      rid("2", { experiment_id: "E1", focal: "pos", obs: 5, exp: 4.0 }),
    ];
    const sheet = longToWide(rows, spec);
    // 2 focal groups x 2 value columns = 4 leaf columns
    expect(sheet.nCols).toBe(4);
    expect(sheet.valueOfCol).toEqual(["obs", "exp", "obs", "exp"]);
    expect(sheet.columnLabels).toEqual(["observed?", "expected?", "observed?", "expected?"]
      .map(() => expect.any(String)));   // labels are the value labels; see impl
    expect(sheet.values[0]).toEqual([3, 2.5, 5, 4.0]);
  });

  it("no spine, a categorical: ragged stack keyed by row id", () => {
    const s = schema(col("contact_type", "categorical"), col("value", "numeric"));
    const spec = groupedSpec(s, []);
    const rows: Row[] = [
      rid("1", { contact_type: "a", value: 1 }),
      rid("2", { contact_type: "a", value: 2 }),
      rid("3", { contact_type: "b", value: 9 }),
    ];
    const sheet = longToWide(rows, spec);
    expect(sheet.nCols).toBe(2);          // a, b
    expect(sheet.nRows).toBe(2);          // deepest stack = a has 2
    expect(sheet.values[0]).toEqual([1, 9]);
    expect(sheet.values[1]).toEqual([2, null]);   // b ragged tail
  });

  it("empty rows -> an empty sheet, no crash", () => {
    const spec = groupedSpec(cellSizeSchema, cellSizeSpine.spine);
    const sheet = longToWide([], spec);
    expect(sheet.nCols).toBe(0);
    expect(sheet.nRows).toBe(0);
  });
});
```

Note on the multi-value label assertion: keep it simple in the impl — leaf label = the value column's `label`. Adjust that one assertion to the exact labels once the impl is in (the deriver uses `col()` whose label equals its name, so labels will be `"obs"`/`"exp"`). Replace the `.map(() => expect.any(String))` line with `expect(sheet.columnLabels).toEqual(["obs", "exp", "obs", "exp"])`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/grouped.test.ts -t longToWide`
Expected: FAIL — `longToWide` still expects `{value, factors}` and has no `valueOfCol`.

- [ ] **Step 3: Rewrite the interface and `longToWide`**

In `src/grouped.ts`, replace the `GroupedSheet` interface with (add `valueOfCol`):

```ts
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
```

Then replace `levelOf` and `longToWide` (old lines ~101-192) with the reference implementation below. It must satisfy every Step-1 test; treat the tests as the contract.

```ts
/* the value of a band column on a row, as a grouping key (null -> "") */
function levelOf(row: Row, name: string): string {
  const v = row[name];
  return v == null ? "" : String(v);
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
    const key = combo.join(" ");
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
    pushBand((g) => cols[g][L], (g) => cols[g].slice(0, L + 1).join(" "));
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/grouped.test.ts`
Expected: PASS. If the `columnLabels` multi-value assertion still uses the placeholder from Step 1, change it to `expect(sheet.columnLabels).toEqual(["obs", "exp", "obs", "exp"])` and re-run.

- [ ] **Step 5: Typecheck the module**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/components/GroupedSheet.tsx` (it still imports the old `applyFactorOrder`/`MAX_GROUPED_COLS`/`avail.spec.value`). `grouped.ts` itself is clean. Task 4 fixes the component.

- [ ] **Step 6: Commit**

```bash
git add src/grouped.ts src/grouped.test.ts
git commit -m "feat(grouped): aligned pivot with multi-value body (slice 1)"
```

---

## Task 4: Wire `GroupedSheet.tsx` to the spine and the new spec

**Files:**
- Modify: `src/components/GroupedSheet.tsx`

The component currently reads `avail.spec.value` / `avail.spec.factors`, re-nests via `factorOrderAtom`/`applyFactorOrder`, and edits a single value column. Rewire it to the new spec, pass the hierarchy in, carry the value column per cell, and drop the deleted cap. The factor strip (add/move/drop levels) is nesting UI that belongs to the hierarchy panel now; Slice 1 removes it from the grouped sheet (its structural edits, `add_level`/`drop_column`/re-nest, are reached from the Data-hierarchy panel). Header rename and column delete stay, because they act on the pivoted layout.

- [ ] **Step 1: Replace the imports and the availability call**

Replace lines 1-11 with:

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  activeSchemaAtom, activeHandleAtom, activeHierarchyAtom,
  bumpActiveHandleAtom, applyTableEditAtom,
} from "../state";
import { engine, type Row } from "../types";
import {
  pivotability, longToWide, type GroupedSheet as Sheet,
} from "../grouped";
import { DataViewToggle } from "./DataViewToggle";
import { DataEntry } from "./DataEntry";
```

Replace the atom reads (old lines 28-33) and the `avail` call (old line 47) with:

```tsx
  const schema = useAtomValue(activeSchemaAtom);
  const handle = useAtomValue(activeHandleAtom);
  const hierarchy = useAtomValue(activeHierarchyAtom);
  const bumpHandle = useSetAtom(bumpActiveHandleAtom);
  const applyEdit = useSetAtom(applyTableEditAtom);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const avail = pivotability(schema, hierarchy);
```

Delete the factor-strip state (`adding`, `addDraft`, `addDone`) and the `orders`/`setOrders` reads.

- [ ] **Step 2: Delete the factor-nesting block and its handlers**

Remove, from the component body: `orderedFactors`, `orderKey`, `moveFactor`, `doAddLevel`, `doDrop`, `requestDrop`, `startAdd`, `commitAdd`, `cancelAdd`, and the entire `.gs-controls` JSX block (old lines 233-261). Remove `drop` and its branch from the `Pending` union and `confirmPending`. These are hierarchy-panel concerns now.

- [ ] **Step 3: Point edit + rename at the new spec**

Replace `commitEdit` (old lines 70-75) so it takes the value column the cell belongs to:

```tsx
  const commitEdit = async (rowId: string, colName: string, value: number | null) => {
    if (!handle) return;
    const { version, counts } = await engine.editCell(handle.id, rowId, colName, value);
    bumpHandle({ ...handle, version, counts });
  };
```

In `requestRelabel` (old lines 127-138), replace the `orderedFactors[level]?.name` lookup with the band column at that level from the spec: `const column = avail.ok ? avail.spec.bandCols[level]?.name : undefined;`. The leaf level maps to `avail.spec.bandCols[level]` as well, since the leaf row is the innermost band (single-value) — guard `level < avail.spec.bandCols.length`.

- [ ] **Step 4: Recompute the sheet from the new spec; drop the deleted cap**

Replace the `sheet` memo (old lines 194-201) with:

```tsx
  const sheet = useMemo<Sheet | null>(
    () => (rows && avail.ok ? longToWide(rows, avail.spec) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, avail.ok, JSON.stringify(hierarchy.spine)],
  );
```

In the `body` IIFE (old lines 203-220), remove the `MAX_GROUPED_COLS` branch entirely (virtualisation is the follow-up slice; do not block). Keep the `!schema || !handle -> <DataEntry />`, `!avail.ok -> <Empty>`, fetchError, and loading branches. Update the `<Grid>` props to pass the new `onCommit` signature (below).

- [ ] **Step 5: Update the `Grid` commit to pass the value column**

In `Grid`, change the `onCommit` prop type to `(rowId: string, colName: string, value: number | null) => void`. In `commit()` (old lines 328-338), read the value column from the sheet and pass it:

```tsx
    const id = rowIds[r][c];
    const raw = draft.trim();
    const value = raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);
    if (id != null && value !== values[r][c]) onCommit(id, sheet.valueOfCol[c], value);
    setEdit(null);
```

`sheet` is not currently in `Grid`'s scope beyond the destructure; add `valueOfCol` to the destructure on old line 311 and use `valueOfCol[c]`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If `factorOrderAtom` is now unused anywhere, that is fine; do not delete the atom in Slice 1 (the nesting-reconciliation slice removes it).

- [ ] **Step 7: Run the unit suite**

Run: `npx vitest run`
Expected: PASS. Fix any component-render test that referenced the removed factor strip by deleting those assertions (search `gs-controls`, `gs-factor`, `Move outward`).

- [ ] **Step 8: Commit**

```bash
git add src/components/GroupedSheet.tsx
git commit -m "feat(grouped): wire the lens to the spine; per-cell value column (slice 1)"
```

---

## Task 5: Persistence round-trip regression test

**Files:**
- Modify: `src/state.test.ts` (append)

Persistence already works (`document.py` + `state.ts:1187`); this pins it so a future change cannot silently drop the spine.

- [ ] **Step 1: Write the test**

Find how `src/state.test.ts` already exercises document open (search for `openDocument`, `loadDocument`, or the atom that adopts `doc.tables`). Mirror that harness. The assertion: a `LoadedTable` carrying `hierarchy.spine = ["a","b"]` produces a pool `WorkspaceTable` whose `hierarchy.spine` is `["a","b"]`; a `LoadedTable` with `spine: []` and identifier columns `a`,`b` seeds `["a","b"]` from `identifierCols`. Use the existing test's schema/table builders. Concretely:

```ts
it("adopts a saved spine verbatim on document open", async () => {
  // ... arrange a doc whose tables[0].hierarchy = { spine: ["a", "b"], fn: {} }
  // ... open it through the same atom the other open tests use
  const t = store.get(tablesAtom)[0];
  expect(t.hierarchy.spine).toEqual(["a", "b"]);
});

it("seeds the spine from identifier columns when the saved spine is empty", async () => {
  // ... doc whose tables[0].hierarchy = { spine: [], fn: {} } and schema has
  //     identifier columns a, b (plus a numeric value)
  const t = store.get(tablesAtom)[0];
  expect(t.hierarchy.spine).toEqual(["a", "b"]);
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/state.test.ts -t spine`
Expected: PASS (the behaviour exists; this just pins it). If it fails, the open path changed — reconcile before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/state.test.ts
git commit -m "test(state): pin the spine survives document open (slice 1)"
```

---

## Task 6: Full verification and the e2e pass

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite + typecheck + lint**

Run: `npx tsc --noEmit && npx vitest run && npx eslint src`
Expected: all green. The e2e memory (`e2e-chromium-available`) confirms Chromium is present, so do not skip the browser pass.

- [ ] **Step 2: Run the grouped-sheet e2e**

Run: `npx playwright test e2e/grouped`  (adjust to the actual spec filename; the grouped-sheet lens e2e was added in the lens epic — `ls e2e/` and pick it).
Expected: PASS. The lens should now open for a spine-carrying table, edit a body cell, and reflect the change in the tidy grid. If the e2e asserted the old factor strip or the col-cap "too many columns" message, update those assertions to the new behaviour (no strip; the sheet renders).

- [ ] **Step 3: Drive it in the real app (verify skill)**

Load a small spine-carrying table (or a trimmed COV2D export with `frame` typed identifier), flip to the grouped view, confirm the pivot shows bands + frame down the side, edit a cell, flip to the tidy grid, confirm the value changed. Use the `run` skill to launch the app.
Expected: the observed behaviour matches. Record what you saw.

- [ ] **Step 4: Final commit if any e2e assertions changed**

```bash
git add e2e
git commit -m "test(e2e): grouped lens opens on a spine, no factor strip (slice 1)"
```

---

## Self-Review notes (for the implementer)

- If `applyFactorOrder`, `MAX_GROUPED_ROWS`, or `MAX_GROUPED_COLS` are imported anywhere besides `GroupedSheet.tsx` and `grouped.test.ts`, grep first (`grep -rn "applyFactorOrder\|MAX_GROUPED" src e2e`) and update those call sites in the same task that removes them.
- The `valueOfCol` array is the single source of truth for which column an edit writes. Never infer the value column from `avail.spec.values[0]` in the component — a multi-value table would write the wrong column.
- Holes (null `rowIds`) must stay read-only, exactly as the current blank-padding cells do.
