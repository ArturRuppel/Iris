# Multiple Input Tables — Plan A (Frontend, no engine change)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the data tab hold a pool of named tables and let an analysis join one onto another, computing correctly — with **no engine change**. Save/load uses today's `.iris` format (Plan B adds the de-duplicated multi-table format).

**Design:** `docs/superpowers/specs/2026-06-27-multi-table-input-design.md` (§3b "Plan A").

**Architecture:** Replace the three single-table atoms (`schemaAtom`/`tableHandleAtom`/`hierarchyAtom`) with a **pool** (`tablesAtom`) of `WorkspaceTable` entries (name, schema, hierarchy, engine session handle). The Data tab views/edits the **active** pool table (`activeTableIdAtom`); each analysis runs against its **main** table (`Plottable.tableId`). A join holds a **`rightTableId`** reference; the referenced table's full rows are materialized from its engine session (uncapped `rowsWindow`) into a version-keyed cache, which the synchronous spec builder reads to inline `right` at the engine boundary. The engine's join contract (left = session, right = inline rows) is unchanged.

**Tech Stack:** TypeScript, React 18.3, Jotai, `@xyflow/react` 12, Vitest 4 + @testing-library/react (jsdom).

**Invariants (do not violate):**
- **No engine change.** Compute resolves a join's right to *full* inline rows (never the 500-row preview). Save uses the existing `/document/save` (one main-table session + inline join rights).
- **No legacy/back-compat in the live model:** after load, there is one in-memory shape; the legacy single-table `.iris` is migrated *at the loader* into the pool, with no legacy branch leaking past it (Iris has no users).
- **Nothing session-only is serialized** beyond what's saved today; the materialized-rows cache and `activeTableIdAtom` are session-only.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017eSJF9bsHq4JiSyLbe78uM
  ```

**Plan A limitation (lifted by Plan B):** a workspace whose analyses are rooted in *different* main tables cannot be saved (today's `/document/save` takes one `table_id`). Save serializes the **active analysis's** main table + every analysis's joins inlined; analyses rooted in a different table are saved with that same main table (a known gap, surfaced to the user in Task 11).

---

## File structure

- **Create** `src/tables.ts` — pure pool helpers (`byId`, `upsertTable`, `seedTableName`) + the `WorkspaceTable` type. Unit-tested without React.
- **Create** `src/tables.test.ts`.
- **Modify** `src/state.ts` — pool atoms; redefine the three globals as derived; pool writers; `loadTableAtom` accumulates; `loadDocumentAtom` migrates; join-right materialization cache + `resolveJoinRight`; `buildSpec`/`runnableSteps` use it; `Plottable.tableId`.
- **Modify** `src/types.ts` — `JoinStep.right: Table` → `rightTableId: string` (internal); keep an engine-facing `EngineJoinStep` with `right: Table`.
- **Modify** the data-tab read sites: `src/components/DataTable.tsx`, `src/components/HierarchyPanel.tsx`, `src/components/DataTab.tsx`, `src/components/CollapseRoutingPanel.tsx`.
- **Modify** `src/explorer/graph.ts` — join `filled`/`missing` from the pool reference.
- **Modify** `src/components/StepJoin.tsx` — show the referenced table's name (read-only in Plan A).
- **Modify** `src/App.tsx` — the materialization effect; the save path resolves references to inline rights.
- **Create** `src/components/TableList.tsx` + test — the data-tab pool list + active selector.
- **Test** files alongside each modified unit.

---

## Task 1: The pool model + pure helpers

**Files:** Create `src/tables.ts`, `src/tables.test.ts`.

- [ ] **Step 1 — failing test.** In `src/tables.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Schema } from "./types";
import { byId, upsertTable, seedTableName, type WorkspaceTable } from "./tables";

const S: Schema = { schema_version: "1.0", columns: [{ name: "v", type: "numeric", label: "V" }] };
const mk = (id: string): WorkspaceTable =>
  ({ id, name: id, schema: S, hierarchy: { spine: [], fn: {} },
     handle: { id: `h_${id}`, n: 1, version: 0, schema: S, counts: {} as never } });

describe("table pool helpers", () => {
  it("byId finds a table or returns null", () => {
    const pool = [mk("a"), mk("b")];
    expect(byId(pool, "b")?.id).toBe("b");
    expect(byId(pool, "z")).toBeNull();
    expect(byId(pool, null)).toBeNull();
  });
  it("upsertTable appends a new id and replaces an existing one (immutably)", () => {
    const pool = [mk("a")];
    const added = upsertTable(pool, mk("b"));
    expect(added.map((t) => t.id)).toEqual(["a", "b"]);
    expect(added).not.toBe(pool);
    const replaced = upsertTable(added, { ...mk("a"), name: "A2" });
    expect(replaced.find((t) => t.id === "a")!.name).toBe("A2");
    expect(replaced.map((t) => t.id)).toEqual(["a", "b"]);   // order preserved
  });
  it("seedTableName makes a unique, filename-derived name", () => {
    expect(seedTableName([], "cells.csv")).toBe("cells");
    expect(seedTableName([mk("cells")], "cells.csv")).toBe("cells_2");
    expect(seedTableName([], undefined)).toBe("table_1");
  });
});
```

- [ ] **Step 2 — run, verify fail.** `npx vitest run src/tables.test.ts` → FAIL (module not found).
- [ ] **Step 3 — implement `src/tables.ts`:**

```ts
import type { Schema, Hierarchy, TableHandle } from "./types";

/* One input table in the workspace pool. Each stands alone: the name analyses
   reference (`id`), a human label, its own schema + hierarchy, and its own engine
   session handle. (Was the global schemaAtom/hierarchyAtom/tableHandleAtom.) */
export interface WorkspaceTable {
  id: string;
  name: string;
  schema: Schema;
  hierarchy: Hierarchy;
  handle: TableHandle;
}

export function byId(pool: WorkspaceTable[], id: string | null): WorkspaceTable | null {
  return id ? pool.find((t) => t.id === id) ?? null : null;
}

/* append a new table or replace the one with the same id, preserving order. */
export function upsertTable(pool: WorkspaceTable[], t: WorkspaceTable): WorkspaceTable[] {
  const i = pool.findIndex((x) => x.id === t.id);
  if (i < 0) return [...pool, t];
  const next = pool.slice();
  next[i] = t;
  return next;
}

/* a unique pool id derived from the imported filename (sans extension), suffixed
   on collision. Falls back to table_N when there is no filename. */
export function seedTableName(pool: WorkspaceTable[], filename: string | undefined): string {
  const base = filename ? filename.replace(/\.[^.]+$/, "") : "";
  const used = new Set(pool.map((t) => t.id));
  if (base && !used.has(base)) return base;
  if (!base) { let n = 1; while (used.has(`table_${n}`)) n++; return `table_${n}`; }
  let n = 2; while (used.has(`${base}_${n}`)) n++; return `${base}_${n}`;
}
```

- [ ] **Step 4 — run, verify pass.** `npx vitest run src/tables.test.ts` → PASS.
- [ ] **Step 5 — commit** (`feat(tables): pool model + pure helpers (byId/upsert/seedTableName)`).

---

## Task 2: Pool atoms + derived active/analysis table (added alongside the globals)

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

**Context.** Introduce the pool *without* removing the three globals yet, so the app stays green. `tablesAtom` holds the pool; `activeTableIdAtom` is the Data-tab selection. Two derived atoms expose "the table the Data tab edits" and "the table the active analysis runs against."

- [ ] **Step 1 — failing test.** In `src/state.test.ts` add:

```ts
import { tablesAtom, activeTableIdAtom, activeTableAtom, analysisTableAtom } from "./state";
// ... inside a new describe:
it("activeTableAtom follows the Data-tab selection; analysisTableAtom follows the active plottable's tableId", () => {
  const store = createStore();
  const wt = (id: string) => ({ id, name: id, schema: SCHEMA,
    hierarchy: { spine: [], fn: {} },
    handle: { id: `h_${id}`, n: 1, version: 0, schema: SCHEMA, counts: {} as never } });
  store.set(tablesAtom, [wt("cells"), wt("annot")]);
  store.set(activeTableIdAtom, "annot");
  const p = { ...makeDefaultPlottable(SCHEMA), tableId: "cells" };
  store.set(plottablesAtom, [p]);
  store.set(activePlottableIdAtom, p.id);
  expect(store.get(activeTableAtom)?.id).toBe("annot");
  expect(store.get(analysisTableAtom)?.id).toBe("cells");
});
```

- [ ] **Step 2 — run, verify fail** (`npx vitest run src/state.test.ts`).
- [ ] **Step 3 — implement.** In `src/state.ts`, near the top atoms, add (import the helpers + type):

```ts
import { byId, upsertTable, seedTableName, type WorkspaceTable } from "./tables";
export type { WorkspaceTable } from "./tables";

/* the workspace pool: every loaded input table (design §4.1). Import accumulates
   into it; analyses reference entries by id. */
export const tablesAtom = atom<WorkspaceTable[]>([]);
/* which pool table the Data tab is currently viewing / editing. */
export const activeTableIdAtom = atom<string | null>(null);

/* the table the Data tab edits (its preview, spine, column roles). */
export const activeTableAtom = atom((get) => byId(get(tablesAtom), get(activeTableIdAtom)));
/* the table the ACTIVE ANALYSIS computes against (its main table). */
export const analysisTableAtom = atom((get) =>
  byId(get(tablesAtom), get(activePlottableAtom)?.tableId ?? null));
```

(Place these *after* `activePlottableAtom` is declared — it is defined ~line 223; put the pool atoms just below it.)

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(state): table pool atoms + derived active/analysis table`).

---

## Task 3: `Plottable.tableId` (the analysis → main-table binding)

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

- [ ] **Step 1 — failing test.** In `src/state.test.ts`:

```ts
it("makeDefaultPlottable seeds tableId from the most-recently-imported pool table", () => {
  const store = createStore();
  const wt = (id: string) => ({ id, name: id, schema: SCHEMA,
    hierarchy: { spine: [], fn: {} },
    handle: { id: `h_${id}`, n: 1, version: 0, schema: SCHEMA, counts: {} as never } });
  store.set(tablesAtom, [wt("cells"), wt("annot")]);
  // makeDefaultPlottable takes the seed id explicitly (pure); the writer passes the last pool id.
  expect(makeDefaultPlottable(SCHEMA, "annot").tableId).toBe("annot");
  expect(makeDefaultPlottable(SCHEMA).tableId).toBe("");   // no pool → empty, resolved later
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** In `src/state.ts`:
  - Add to `interface Plottable` (after `id`/`name`): `tableId: string;  // the main table's pool id (design §4.2)`.
  - Change `makeDefaultPlottable(schema: Schema)` to `makeDefaultPlottable(schema: Schema, tableId = "")` and set `tableId` on the returned object.
  - In `plottableFromSpec(spec)`, set `tableId: (spec as { table_id?: string }).table_id ?? ""` (Plan B emits `table_id`; legacy specs leave it empty → resolved to the single pool table at load, Task 9). For a join step that still carries an inline `right` (a loaded legacy spec), `plottableFromSpec` emits `{ kind:"join", on, how, rightTableId: "" }` (an unfilled reference); Task 9's migration fills `rightTableId` from the **raw** spec's inline `right` (it reads `spec.reduce.steps`, not the already-stripped plottable). So `plottableFromSpec` never needs the inline rows.
  - In `duplicatePlottableAtom`, carry `tableId` from the source.

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(state): Plottable.tableId binds an analysis to its main table`).

---

## Task 4: Switch the three globals to derive off the analysis's table

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

**Context.** Redefine `schemaAtom`, `tableHandleAtom`, `hierarchyAtom` as **read-only derived** atoms off `analysisTableAtom`, so the ~20 analysis-facing read sites (graph, spec, reduce preview, layers, collapse) keep working unchanged. Their former *writes* move to pool writers (Task 5). The Data-tab read sites get their own `active*` atoms in Task 6.

This task is the switchover; after it, the app reads the active analysis's table everywhere those names appear.

- [ ] **Step 1 — failing test.** In `src/state.test.ts`:

```ts
it("schemaAtom/hierarchyAtom/tableHandleAtom reflect the active analysis's pool table", () => {
  const store = createStore();
  const S2: Schema = { schema_version: "1.0", columns: [{ name: "x", type: "numeric", label: "X" }] };
  const wt = (id: string, s: Schema) => ({ id, name: id, schema: s,
    hierarchy: { spine: [id], fn: {} },
    handle: { id: `h_${id}`, n: 5, version: 1, schema: s, counts: {} as never } });
  store.set(tablesAtom, [wt("cells", SCHEMA), wt("annot", S2)]);
  const p = { ...makeDefaultPlottable(SCHEMA, "annot"), tableId: "annot" };
  store.set(plottablesAtom, [p]); store.set(activePlottableIdAtom, p.id);
  expect(store.get(schemaAtom)).toBe(S2);
  expect(store.get(tableHandleAtom)?.id).toBe("h_annot");
  expect(store.get(hierarchyAtom).spine).toEqual(["annot"]);
});
```

- [ ] **Step 2 — run, verify fail** (the old primitive atoms ignore the pool).
- [ ] **Step 3 — implement.** Replace the three primitive declarations:
  - `export const schemaAtom = atom<Schema | null>(null);` → `export const schemaAtom = atom((get) => get(analysisTableAtom)?.schema ?? null);`
  - `export const tableHandleAtom = atom<TableHandle | null>(null);` → `export const tableHandleAtom = atom((get) => get(analysisTableAtom)?.handle ?? null);`
  - `export const hierarchyAtom = atom<Hierarchy>({ spine: [], fn: {} });` → `export const hierarchyAtom = atom((get) => get(analysisTableAtom)?.hierarchy ?? { spine: [], fn: {} });`
  - Delete the now-unused `set(schemaAtom, …)` / `set(tableHandleAtom, …)` / `set(hierarchyAtom, …)` calls in `loadTableAtom`, `loadDocumentAtom`, `setColumnRoleAtom`, `moveSpineAtom`, `setLevelFnAtom` — they move to pool writers in Tasks 5/9. (Temporarily these writers are broken; Task 5 restores them. To keep each commit green, **do Tasks 4 and 5 as one commit** — see Task 5 Step 5.)
  - Move the `analysisTableAtom`/`activeTableAtom` definitions ABOVE these three (they now depend on `analysisTableAtom`). Keep `activePlottableAtom` above all of them.
  - `DataTable.tsx` calls `useSetAtom(tableHandleAtom)` (line 36) — that set is removed in Task 6.

- [ ] **Step 4 — run the new test, verify pass.** (Full suite still red until Task 5 — expected; note it and continue.)
- [ ] **Step 5 — do NOT commit yet** (combined with Task 5).

---

## Task 5: Pool writers — `loadTableAtom` accumulates; column-role/spine/fn edit the active table

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

**Context.** Restore the writers removed in Task 4 by routing them into the pool. `loadTableAtom` now **adds** a table (and selects it + seeds a default analysis bound to it). `setColumnRoleAtom`/`moveSpineAtom`/`setLevelFnAtom` update the **active** pool table's entry.

- [ ] **Step 1 — failing test.** In `src/state.test.ts`:

```ts
it("loadTableAtom appends to the pool, selects it, and seeds an analysis bound to it", async () => {
  const store = createStore();
  // engine.createSession is network — stub it.
  // (Use vi.spyOn(engine, "createSession").mockResolvedValue({ id: "h1", n: 2, version: 0, schema: SCHEMA, counts: {} }))
  await store.set(loadTableAtom, { schema: SCHEMA, rows: [], token: undefined } as never);
  const pool = store.get(tablesAtom);
  expect(pool).toHaveLength(1);
  expect(store.get(activeTableIdAtom)).toBe(pool[0].id);
  expect(store.get(activePlottableAtom)?.tableId).toBe(pool[0].id);
});
it("setColumnRoleAtom edits the ACTIVE pool table's schema", async () => {
  // seed a pool with one table active; call setColumnRoleAtom; assert tablesAtom entry's schema changed,
  // and another (non-active) table is untouched.
});
```

(The implementing agent writes the second test body concretely against the real `setColumnRoleAtom` signature — `{ name, role }` — stubbing `engine.distinct` as the existing tests do.)

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.**
  - **`loadTableAtom`** (replace the body's `set(schemaAtom…)/set(tableHandleAtom…)/set(hierarchyAtom…)` block): after creating the session `handle`, build the pool entry and append:
    ```ts
    const id = seedTableName(get(tablesAtom), (table as { name?: string }).name);
    const entry: WorkspaceTable = { id, name: id, schema: table.schema,
      hierarchy: { spine: identifierCols(table.schema), fn: {} }, handle };
    set(tablesAtom, upsertTable(get(tablesAtom), entry));
    set(activeTableIdAtom, id);
    ```
    Keep the reset of `analysisByIdAtom`/`analysisKeyByIdAtom`/`analysisRecencyAtom`/`reducePreviewByIdAtom`. Replace the trailing default-plottable block with one bound to the new table:
    ```ts
    const first = makeDefaultPlottable(table.schema, id);
    set(plottablesAtom, [...get(plottablesAtom), first]);   // ADD, don't replace
    set(activePlottableIdAtom, first.id);
    ```
    (Importing a second table adds a second default analysis rooted in it; existing analyses are untouched.)
  - **`setColumnRoleAtom`/`moveSpineAtom`/`setLevelFnAtom`:** each currently reads/writes `schemaAtom`/`hierarchyAtom`. Rewrite to read the **active** table from the pool and write the updated entry back:
    ```ts
    const t = get(activeTableAtom); if (!t) return;
    // ...compute nextSchema / nextHierarchy as before, off t.schema / t.hierarchy...
    set(tablesAtom, upsertTable(get(tablesAtom), { ...t, schema: nextSchema, hierarchy: nextHierarchy }));
    ```
    For `setColumnRoleAtom` the engine re-upload (`engine.createSession`/schema change) must update `t.handle` too — keep the existing engine call, then write `{ ...t, schema, hierarchy, handle: newHandle }`.

- [ ] **Step 4 — run, verify pass.** Then run the **full suite** (`npm test -- --run`) — green again.
- [ ] **Step 5 — commit Tasks 4 + 5 together** (`refactor(state): the three single-table globals derive off the pool; writers edit pool entries`).

---

## Task 6: Migrate the Data-tab read sites to `active*` atoms

**Files:** Modify `src/state.ts` (add `activeSchemaAtom`/`activeHierarchyAtom`/`activeHandleAtom`), `src/components/DataTable.tsx`, `src/components/HierarchyPanel.tsx`, `src/components/CollapseRoutingPanel.tsx`, and their tests where present.

**Context.** These components edit/view **the table the Data tab is on**, not the active analysis's table. They must read the `active*` table, not the (now analysis-derived) `schemaAtom`/`hierarchyAtom`/`tableHandleAtom`.

- [ ] **Step 1 — add derived Data-tab atoms** in `src/state.ts`:

```ts
export const activeSchemaAtom = atom((get) => get(activeTableAtom)?.schema ?? null);
export const activeHierarchyAtom = atom((get) => get(activeTableAtom)?.hierarchy ?? { spine: [], fn: {} });
export const activeHandleAtom = atom((get) => get(activeTableAtom)?.handle ?? null);
```

- [ ] **Step 2 — migrate the components** (read-only swaps):
  - `DataTable.tsx`: `schemaAtom`→`activeSchemaAtom`, `tableHandleAtom`→`activeHandleAtom`. The `useSetAtom(tableHandleAtom)` (cell-edit version bump) becomes a new writer `bumpActiveHandleAtom` (Step 3).
  - `HierarchyPanel.tsx`: `schemaAtom`→`activeSchemaAtom`, `hierarchyAtom`→`activeHierarchyAtom`, `tableHandleAtom`→`activeHandleAtom`.
  - `CollapseRoutingPanel.tsx`: this edits the **analysis's** collapse plan over the **analysis's** table — keep it on `schemaAtom`/`hierarchyAtom` (analysis-derived). **No change.** (Listed here only to confirm it was reviewed.)

- [ ] **Step 3 — `bumpActiveHandleAtom`** in `src/state.ts` (DataTable cell edits bump the active table's handle version):

```ts
export const bumpActiveHandleAtom = atom(null, (get, set, h: TableHandle) => {
  const t = get(activeTableAtom); if (!t) return;
  set(tablesAtom, upsertTable(get(tablesAtom), { ...t, handle: h }));
});
```

In `DataTable.tsx` replace `setHandle(next)` with `bumpActiveHandle(next)`.

- [ ] **Step 4 — run, verify pass** (`npm test -- --run`).
- [ ] **Step 5 — commit** (`refactor(data-tab): DataTable/HierarchyPanel read the active pool table`).

---

## Task 7: `JoinStep` references its right table by id

**Files:** Modify `src/types.ts`, `src/state.ts`, `src/state.test.ts`, `src/components/StepJoin.tsx`.

**Context.** The internal join holds a `rightTableId`; the engine still receives `right: Table` (Task 8 resolves it). Split the types so the boundary is explicit.

- [ ] **Step 1 — failing test.** In `src/state.test.ts`:

```ts
it("makeStep('join') starts with an empty rightTableId (the unfilled reference)", () => {
  const j = makeStep("join");
  expect(j).toMatchObject({ kind: "join", on: [], how: "inner", rightTableId: "" });
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.**
  - In `src/types.ts`, change `JoinStep`:
    ```ts
    /* inner, spine-aligned, coarse->fine broadcast join. The right side is a pool
       table referenced by id; it is resolved to an inline table at the engine
       boundary (see state.resolveJoinRight). */
    export interface JoinStep { kind: "join"; on: string[]; how: "inner"; rightTableId: string; _key?: string }
    ```
    Add the engine-facing shape (what `/analyze` + `/reduce` receive):
    ```ts
    export interface EngineJoinStep { kind: "join"; on: string[]; how: "inner"; right: Table }
    export type EngineReduceStep = Exclude<ReduceStep, JoinStep> | EngineJoinStep;
    ```
  - In `src/state.ts` `makeStep`, the `join` case becomes `return { _key, kind, on: [], how: "inner", rightTableId: "" };`. Delete `EMPTY_RIGHT` (now unused) and its export; update `src/state.test.ts`'s `runnableSteps`/`EMPTY_RIGHT` tests accordingly (Task 8).
  - `StepJoin.tsx`: replace the `step.right.rows.length / step.right.schema.columns.length` summary with the referenced name: `right table · {step.rightTableId || "—"}`. The `on`-toggle stays. (Picking the table is the workbench slice; here it is read-only.)

- [ ] **Step 4 — run, verify pass.** `npx tsc --noEmit` will surface every other `step.right` use — fix each (graph.ts in Task 8a; any others by following the type error to the right `rightTableId`/resolution).
- [ ] **Step 5 — commit** (`feat(types): JoinStep references its right table by id; EngineJoinStep keeps inline right`).

---

## Task 8: Materialize references → inline rights (the compute boundary)

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

**Context.** A version-keyed cache holds each referenced table's *full* rows (fetched from its session). `resolveJoinRight` reads the cache synchronously; `buildSpec`/`runnableSteps` use it so the engine receives inline rights. The async fetch lives in an effect (Task 10).

- [ ] **Step 1 — failing test.** In `src/state.test.ts`:

```ts
import { materializedTablesAtom, runnableSteps, resolveEngineSteps } from "./state";
it("runnableSteps drops a join whose rightTableId is unset or not materialized", () => {
  const cache = {};                                  // nothing materialized
  expect(runnableSteps([makeStep("filter"), makeStep("join")], cache).map((s) => s.kind))
    .toEqual(["filter"]);
});
it("resolveEngineSteps inlines a materialized right table", () => {
  const right: Table = { schema: { schema_version: "1.0", columns: [
    { name: "k", type: "identifier", label: "K" }] }, rows: [{ id: "1", k: "a" }] };
  const cache = { annot: { version: 0, table: right } };
  const steps = [{ ...makeStep("join"), rightTableId: "annot", on: ["k"] }];
  const out = resolveEngineSteps(steps, cache);
  expect(out[0]).toMatchObject({ kind: "join", on: ["k"], right });
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement** in `src/state.ts`:

```ts
/* full rows of pool tables referenced by a join, fetched from their sessions and
   keyed by handle version so an edit re-materializes (design §5, §11). Session-only. */
export const materializedTablesAtom = atom<Record<string, { version: number; table: Table }>>({});

type RightCache = Record<string, { version: number; table: Table }>;

/* a join is runnable once its right is materialized; unset/unmaterialized joins are
   skipped (display degrades gracefully until the fetch lands). */
export function runnableSteps(steps: ReduceStep[], cache: RightCache): ReduceStep[] {
  return steps.filter((s) => s.kind !== "join" || (!!s.rightTableId && !!cache[s.rightTableId]));
}

/* map internal steps to the engine-facing steps, inlining each runnable join's
   right table from the cache. Assumes runnableSteps already dropped unresolved joins. */
export function resolveEngineSteps(steps: ReduceStep[], cache: RightCache): EngineReduceStep[] {
  return runnableSteps(steps, cache).map((s) =>
    s.kind === "join"
      ? { kind: "join", on: s.on, how: s.how, right: cache[s.rightTableId].table }
      : s);
}
```

  - Update `buildSpec` to take the cache and call `resolveEngineSteps`: change its signature to `buildSpec(p, family, rec, snapshot, hierarchy, cache: RightCache)` and `reduce: { steps: resolveEngineSteps(p.reduce.steps, cache).map(stripStepKey) }`. (`AnalysisSpec.reduce.steps` typing widens to `EngineReduceStep[]` — update the `AnalysisSpec` type in `types.ts`.)
  - `specAtom` passes `get(materializedTablesAtom)`.
  - Remove the old single-arg `runnableSteps`/`EMPTY_RIGHT` tests; keep the new ones.

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(state): materialized-right cache; resolve join references to inline rights at the engine boundary`).

---

## Task 8a: `buildGraph` derives a join's missing/filled state from the reference

**Files:** Modify `src/explorer/graph.ts`, `src/explorer/graph.test.ts`, `src/explorer/graphAtom.ts`.

**Context.** The graph drew the open circle from `step.right.schema.columns.length`. Now `filled` is "the reference is set" — and, to keep the circle honest, "set" means a non-empty `rightTableId`.

- [ ] **Step 1 — failing test.** In `src/explorer/graph.test.ts`, replace the two join tests (`UNFILLED join`/`FILLED join`) to drive off `rightTableId`:

```ts
it("an UNFILLED join (empty rightTableId) renders its right input as a missing node", () => {
  const steps: ReduceStep[] = [{ kind: "join", on: [], how: "inner", rightTableId: "" }];
  const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
  const src = g.nodes.find((n) => n.id === "source:0");
  expect(src?.missing).toBe(true);
  expect(src?.label).toBe("drop a table here");
});
it("a FILLED join (rightTableId set) is not missing (label = the table name)", () => {
  const steps: ReduceStep[] = [{ kind: "join", on: ["k"], how: "inner", rightTableId: "annot" }];
  const g = buildGraph(steps, SPINE, PLAN, [{ geom: "dot", level: RAW_LEVEL }], SCHEMA, null);
  const src = g.nodes.find((n) => n.id === "source:0");
  expect(src?.missing).toBeFalsy();
  expect(src?.label).toBe("annot");
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** In `graph.ts` join branch: `const filled = step.rightTableId.length > 0;` and `label: filled ? step.rightTableId : "drop a table here"`. Remove `joinSourceLabel`/`joinKeyLabel` uses of `step.right` (the on-key label can use `step.on.join(", ")` directly). The `buildGraph` join no longer reads a right `Table`.
- [ ] **Step 4 — run, verify pass** (`npx vitest run src/explorer/graph.test.ts`).
- [ ] **Step 5 — commit** (`feat(graph): join missing/filled derives from rightTableId`).

---

## Task 9: Load migration — legacy inline `right` → pool reference

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

**Context.** `loadDocumentAtom` must build the pool from the loaded doc (one main table today), bind every analysis's `tableId` to it, and convert any inline `join.right` (legacy/Plan-A save) into a pool table + a `rightTableId` reference.

- [ ] **Step 1 — failing test.** In `src/state.test.ts`:

```ts
it("loadDocument seeds the pool, binds analyses, and migrates inline join.right to a reference", () => {
  const store = createStore();
  const right = { schema: { schema_version: "1.0", columns: [
    { name: "k", type: "identifier", label: "K" }] }, rows: [{ id: "1", k: "a" }] };
  const spec = { ...makeSpec("a", { xCol: "grp" }),
    reduce: { steps: [{ kind: "join", on: ["k"], how: "inner", right }] } };
  store.set(loadDocumentAtom, { schema: SCHEMA, id: "h0", n: 1, version: 0,
    counts: {} as never, analyses: [spec] } as never);
  const pool = store.get(tablesAtom);
  expect(pool.length).toBe(2);                                   // main + the migrated right
  const p = store.get(plottablesAtom)[0];
  expect(p.tableId).toBe(pool[0].id);                            // bound to the main table
  const join = p.reduce.steps[0];
  expect(join.kind === "join" && join.rightTableId).toBe(pool[1].id);
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Rewrite `loadDocumentAtom`:
  - Build the main pool entry from `doc.schema` + the adopted handle (`{ id: doc.id, n, version, schema, counts }`) + the saved hierarchy (off `doc.analyses[0]?.hierarchy` or `identifierCols`). Give it a name (`"table_1"` or from the doc if present). `set(tablesAtom, [main])`, `set(activeTableIdAtom, main.id)`.
  - For each analysis: `plottableFromSpec`, then **migrate joins**: for each `join` step that still has an inline `right` (legacy shape), create a pool entry (the right needs its own session — `engine.createSession({ schema: right.schema, rows: right.rows })`; since `loadDocumentAtom` is sync today, make it **async** like `loadTableAtom`, awaiting the session), add via `upsertTable`, and replace the step with `{ kind:"join", on, how, rightTableId: <newId> }`. Dedup identical rights by content hash so two analyses sharing a right table reuse one pool entry. Bind `tableId` to `main.id` when the spec's `table_id` is empty.
  - Keep the existing resets of analysis caches.

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(state): loadDocument builds the pool and migrates inline join rights to references`).

---

## Task 10: Materialization effect — keep referenced tables' rows fetched

**Files:** Modify `src/App.tsx` (or a small new `src/components/MaterializeTables.tsx` mounted in App), add a focused test for the pure "what needs fetching" selector in `src/state.ts`.

**Context.** Whenever an analysis references a pool table via a join, that table's full rows must be in `materializedTablesAtom` at the current handle version. An effect computes the set of referenced `rightTableId`s, fetches any missing/stale ones via `engine.rowsWindow(handle.id, 0, handle.n)`, and writes the cache.

- [ ] **Step 1 — failing test (pure selector).** In `src/state.ts` add and test `tablesNeedingMaterialize(get)`:

```ts
it("tablesNeedingMaterialize lists referenced tables missing or stale in the cache", () => {
  // pool has cells(v1) + annot(v2); an analysis joins annot; cache has annot@v1 (stale)
  // → returns [annot]; after cache annot@v2 → returns [].
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement** the selector (referenced ids = every active-or-background analysis's join `rightTableId`s; needing = no cache entry or `cache[id].version !== pool table handle.version`), then the effect in `App.tsx`:

```ts
// materialize referenced join tables (full rows) so the engine receives inline rights.
const tables = useAtomValue(tablesAtom);
const plottables = useAtomValue(plottablesAtom);
const setMaterialized = useSetAtom(materializedTablesAtom);
useEffect(() => {
  let cancelled = false;
  void (async () => {
    const need = store.get(tablesNeedingMaterializeAtom);   // or compute inline from tables+plottables
    for (const t of need) {
      const res = await engine.rowsWindow(t.handle.id, 0, t.handle.n);
      if (cancelled) return;
      setMaterialized((prev) => ({ ...prev, [t.id]: { version: t.handle.version,
        table: { schema: t.schema, rows: res.rows } } }));
    }
  })();
  return () => { cancelled = true; };
}, [tables, plottables, setMaterialized]);
```

(Expose `tablesNeedingMaterializeAtom` as a derived atom wrapping the selector so the effect reads it directly.)

- [ ] **Step 4 — run, verify pass; manually confirm** a join renders once its right is fetched (E2E in Task 12).
- [ ] **Step 5 — commit** (`feat(app): materialize referenced join tables from their sessions`).

---

## Task 11: Save path resolves references to inline rights (today's format)

**Files:** Modify `src/App.tsx`, `src/state.ts`, `src/state.test.ts`.

**Context.** `engine.saveDocument(tableId, analyses, …)` expects analyses with inline `join.right`. Resolve each analysis's `rightTableId` from the materialized cache (or fetch) before saving, and pass the **active analysis's** main-table session id as `tableId`. Surface the Plan-A limitation if analyses span different main tables.

- [ ] **Step 1 — failing test.** In `src/state.test.ts`, test a pure `specForSave(p, cache, …)` that emits a spec whose joins carry inline `right` (mirrors `buildSpec` but always inlines, never skips):

```ts
it("specForSave inlines a join's right from the cache (for today's .iris format)", () => {
  const right = { schema: { schema_version: "1.0", columns: [
    { name: "k", type: "identifier", label: "K" }] }, rows: [{ id: "1", k: "a" }] };
  const cache = { annot: { version: 0, table: right } };
  const p = { ...makeDefaultPlottable(SCHEMA, "cells"),
    reduce: { steps: [{ ...makeStep("join"), rightTableId: "annot", on: ["k"] }] } };
  const spec = specForSave(p, "group_comparison", "welch_t", {}, { spine: [], fn: {} }, cache);
  expect(spec.reduce.steps[0]).toMatchObject({ kind: "join", right });
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** `specForSave` = `buildSpec` but using `resolveEngineSteps` *without* dropping (assert all referenced tables are materialized first; if a referenced table is missing from the cache, fetch it in the save handler before calling). In `App.tsx` `doSave`/`doSaveAs`: materialize any not-yet-cached referenced tables, build `allSpecs` via `specForSave`, pass `analysisTable.handle.id` as the save `tableId`. If `plottables` reference more than one distinct `tableId`, show a one-line notice ("Saving uses <active table>; multi-root save needs Plan B") and proceed with the active analysis's table.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(app): save resolves join references to inline rights (today's .iris format)`).

---

## Task 12: The data-tab table list + active selector

**Files:** Create `src/components/TableList.tsx`, `src/components/TableList.test.tsx`; modify `src/components/DataTab.tsx`.

- [ ] **Step 1 — failing test.** In `TableList.test.tsx`: render with a seeded pool of two tables; assert both names show; clicking one sets `activeTableIdAtom`; the active one has an `aria-current`/active class.
- [ ] **Step 2 — run, verify fail; implement `TableList`** — a list reading `tablesAtom` + `activeTableIdAtom`, each row a button calling `set(activeTableIdAtom, t.id)`; the active row marked. Mount it in `DataTab.tsx` above the existing `NodeTable`/`HierarchyPanel`.
- [ ] **Step 3 — run, verify pass.**
- [ ] **Step 4 — commit** (`feat(data-tab): table pool list + active selector`).

---

## Task 13: E2E — load two tables, join, render, save/load round-trip

**Files:** Modify the Playwright e2e suite (find the existing workbench/import e2e under `e2e/` or `tests/e2e/`).

- [ ] **Step 1 — write the e2e:** import a primary CSV; import a second CSV (pool shows two); in the workbench, author a join and set its `rightTableId` to the second table (Plan A: drive the spec directly if the drag UI is not yet built — set the active plottable's join `rightTableId` via the store, or via the StepJoin once it gains a picker in the workbench slice); confirm the figure recomputes (a join column appears). Save to `.iris`, reload, confirm the join survives as a reference and the figure is identical.
- [ ] **Step 2 — run** (`npx playwright test <file>`), verify pass.
- [ ] **Step 3 — commit** (`test(e2e): multi-table import → join → render → save/load round-trip`).

---

## Done criteria (Plan A)
- The data tab accumulates N named tables; importing a second leaves the first in the pool; a selector switches the active table.
- An analysis is bound to a main table (`tableId`); its figure/stats/preview run against that table's session + hierarchy.
- A join references a pool table by `rightTableId`; the engine receives the **full** right table inline (never the preview); an unset/unmaterialized reference renders the open circle and is skipped.
- Save/load round-trips an analysis with a join (reference → inline on save → reference on load).
- `npm test -- --run`, `npx tsc --noEmit`, `npm run build` all green; the materialized cache and `activeTableIdAtom` are session-only; no dead code (`EMPTY_RIGHT` removed, no `step.right` reads left).

## Out of scope (Plan A → other slices)
- The **drag-to-fill-a-join** canvas gesture (workbench connection-authoring Task 6, revised to set `rightTableId` from the pool).
- The **de-duplicated named-`tables` `.iris` format** and **multi-main-table save** (Plan B).
- Table **rename/remove/reorder**; a per-analysis main-table **picker UI**.
