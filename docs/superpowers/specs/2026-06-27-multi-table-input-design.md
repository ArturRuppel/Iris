# Multiple Input Tables in the Data Tab — Design

**Status:** Design (brainstorming, 2026-06-27)
**Builds on:** the single-table data model (`src/state.ts` — `tableHandleAtom` / `schemaAtom` / `hierarchyAtom`) and the import wizard (`src/components/ImportWizard.tsx`).
**Unblocks:** the workbench connection-authoring plan's drag-to-join (Task 6 of `2026-06-27-workbench-connection-authoring-design.md`), which needs a *separate* table to be a join's right input. Today no such table can exist.

---

## 1. Goal

Let the data tab hold **several input tables at once** instead of exactly one, so an analysis can **join one table onto another**. The data tab becomes a *pool* of named tables that import accumulates into; an analysis points at the tables it uses **by name**.

One sentence: **the data tab accumulates N named tables; an analysis names one as its main table (the rows it plots) and may join others in by name.**

## 2. Why this exists (the load-bearing facts)

- A **join is asymmetric**: it attaches a second table's columns onto the rows of a first. One table provides the rows you plot (one mark each); the other contributes columns. The engine's join is explicitly a *coarse→fine broadcast* (`reduce.py:_apply_join`), so direction is intrinsic, not an artifact. The table whose rows are plotted is the analysis's **main table**.
- The **engine already holds multiple sessions** (`session.py` `SessionStore`, LRU, up to 8). The single-table assumption lives entirely in the **frontend**.
- The **engine's join wants the right table's rows inline** (`right.rows` must be present; it may also carry its own `reduce`/`collapse` sub-pipeline). The 500-row `/reduce` **preview is display-only** and must never feed a join. The client can fetch a session's *full* rows via the existing windowed row fetch (`engine.rowsWindow`, uncapped range) — so a join's right table is always the complete table, with **no engine change**.
- `join.right` is **not authored in-app today** — `StepJoin.tsx` shows it read-only; it only ever arrives baked into a loaded `.iris`.

## 3. Core principles

1. **A pool of named tables.** The single table becomes an ordered, **named** pool. Each entry stands alone: name (its ID), schema, its own hierarchy (spine + per-level fn), and its own engine session handle. Import **adds**; it never replaces.
2. **An analysis binds to tables by name.** A plottable gains a **`tableId`** — the name of its main table. Its preview/figure/stats run against *that* table's session and hierarchy, looked up in the pool. A new analysis defaults `tableId` to the most-recently-imported table; **no picker UI**.
3. **Joins reference by name, resolve at the boundary.** A join holds the **name** of a pool table, not a copy. The full table is materialized only when computing (fetched live from its session, so edits are reflected) and when saving (written into the file). The preview never feeds a join.
4. **Self-contained, de-duplicated saves.** A `.iris` gains a top-level **`tables`** section storing each referenced table once (schema + full rows); analyses refer to tables by name. Old single-table files still load (migration in §7).
5. **No engine or `.iris`-read regressions.** No new engine endpoint; no new spec capability the engine doesn't already support. Iris must still read today's single-table `.iris` (it is the CellFlow→Iris export contract).

## 4. Data model

### 4.1 The pool (`src/state.ts`)

A new `WorkspaceTable` and the pool that holds them:

```ts
interface WorkspaceTable {
  id: string;            // the name analyses reference; stable for the session
  name: string;          // human label (defaults from the imported filename)
  schema: Schema;
  hierarchy: Hierarchy;  // per-table spine + fn (was the global hierarchyAtom)
  handle: TableHandle;   // this table's engine session
}
export const tablesAtom = atom<WorkspaceTable[]>([]);     // the pool (ordered)
export const activeTableIdAtom = atom<string | null>(null); // which table the Data tab views/edits
```

The three single-table atoms are **replaced** (not kept for back-compat — Iris has no users):

- `schemaAtom`, `tableHandleAtom`, `hierarchyAtom` become **per-table fields** on `WorkspaceTable`.
- Small **derived "active table" helpers** preserve most call sites' shape. The *Data-tab*-facing ones read `activeTableIdAtom`; the *analysis*-facing ones read the active plottable's `tableId`:

```ts
// the table the Data tab is viewing/editing
export const activeTableAtom = atom((get) => byId(get(tablesAtom), get(activeTableIdAtom)));
// the table the ACTIVE ANALYSIS runs against (its main table)
export const analysisTableAtom = atom((get) =>
  byId(get(tablesAtom), get(activePlottableAtom)?.tableId ?? null));
```

Read sites migrate to whichever of these two matches their intent. `effectiveSchemaAtom`, `NodeTable`'s fetches, the render loop, and the spec builder all key off `analysisTableAtom` (the analysis's main table); the Data tab's editors key off `activeTableAtom`.

### 4.2 The analysis (`Plottable`)

`Plottable` gains `tableId: string`. `makeDefaultPlottable` seeds it from the most-recently-imported table (the last pool entry). Every place that runs the engine for an analysis resolves `tableId → WorkspaceTable → handle/hierarchy` instead of reading a global.

### 4.3 The join step (`src/types.ts`)

`JoinStep.right: Table` becomes a **named reference** in the live model:

```ts
interface JoinStep { kind: "join"; on: string[]; how: "inner";
  rightTableId: string; _key?: string }   // was: right: Table
```

`EMPTY_RIGHT` / the "missing input" state becomes `rightTableId === ""` (an unset reference) — the open circle, unchanged in behavior. `makeStep("join")` produces `{ ..., rightTableId: "" }`.

## 5. Boundary resolution — names → data

A pure-ish resolver materializes a reference to a full `Table` by reading the referenced table's session:

```ts
// fetch the FULL rows of a pool table from its engine session (no preview cap)
async function materializeTable(t: WorkspaceTable): Promise<Table>  // engine.rowsWindow(handle.id, 0, handle.n)
```

- **Computing a figure (`/analyze`, `/reduce`):** before the request, each `join.rightTableId` is resolved to a full inline `right: Table` (its sub-pipeline empty in v1 — wire the table as-is). The request the engine sees is byte-for-byte the join it already accepts. An **unset or dangling** reference is **skipped** (the existing `runnableSteps` guard, retargeted to `rightTableId === "" || !pool.has(id)`). The analyze call targets the analysis's main-table session.
- **Saving:** every referenced table (each analysis's main table + every join's right) is materialized once into the `tables` section; references stay as names.

Resolution is async, which is fine: the analyze/reduce/save paths are already async. The synchronous `specAtom` (used for cache keys / display) carries the *reference*; the async request builder inlines rows just before the POST.

## 6. Save / load format (`.iris`)

### 6.1 New shape (what Iris writes)

```jsonc
{
  "tables": {
    "cells":       { "schema": { ... }, "hierarchy": { "spine": [...], "fn": {...} }, "rows": [ ... ] },
    "annotations": { "schema": { ... }, "hierarchy": { "spine": [...], "fn": {...} }, "rows": [ ... ] }
  },
  "analyses": [
    { "id": "...", "table_id": "cells",
      "reduce": { "steps": [ /* ... */ { "kind": "join", "on": ["cell_id"], "how": "inner", "right_table_id": "annotations" } ] },
      /* encodings, layers, stats, ... — NO hierarchy here */ }
  ]
}
```

Each table appears **once**; analyses reference by name. The **hierarchy lives in the table entry**, not the analysis (it is a property of the table — its identifier columns and per-level aggregation — shared by every analysis rooted in that table). This is the one real format change from today, where a single global hierarchy rode alongside the lone table.

### 6.2 Loading

- **New format** (`tables` present): rebuild the pool (create a session per table from its rows), then reconnect each analysis by `table_id` / `right_table_id`.
- **Legacy single-table format** (no `tables`; a join carries inline `right`): **migrate on load** — the document's one table becomes the single pool entry; for each inline `join.right`, add it to the pool under a generated name (`right_1`, deduped by content) and replace the inline table with that name. After load there is **one** in-memory shape; no legacy branch leaks past the loader.

## 7. The data tab UI

Minimal. The data tab renders the **list of pool tables** with a selector for the active one; the existing editors (preview `NodeTable`, `HierarchyPanel` spine/roles, cell edit) bind to `activeTableAtom`. "Import" appends to the pool (the `ImportWizard` flow is unchanged except its final `loadTableAtom` call **adds** rather than **replaces**). No rename / remove / reorder in this slice.

## 8. Error handling & edges

- **Unset / dangling `rightTableId`:** the join renders its open "missing" circle and is skipped on the run path (graceful; same as a fresh blank join).
- **Editing a referenced table:** materialization reads live from the session, so a join always sees current rows; no stale client copy.
- **Engine 8-session cap:** if the pool exceeds the engine's LRU, an evicted table's session is recreated on demand from its rows (the existing token/inline `createSession` fallback). Not expected in this slice, but the design doesn't assume unbounded sessions.
- **Empty pool:** the Data tab shows the existing import affordance; analyses can't be created until one table exists (unchanged from today).

## 9. Testing strategy

- **Pure units (vitest):** pool add/lookup and the active-table helpers; `makeStep("join")` yields an unset reference; `runnableSteps` skips unset/dangling references; the save serializer emits a de-duplicated `tables` section; the loader rebuilds the pool and reconnects names.
- **Migration:** a legacy single-table `.iris` with an inline `join.right` loads to a two-entry pool + a `rightTableId` reference (round-trips to the new format on re-save).
- **Component (RTL):** the data tab lists pool tables and switches the active one; importing a second file leaves the first in the pool.
- **No engine test changes** (no engine change).

## 10. Out of scope (separate follow-ups)

- **The drag-to-join gesture** — filling a join's open circle by choosing a pool table on the canvas. This is the workbench connection-authoring slice (Task 6), revised to fill `rightTableId` from the pool; this design only makes it *possible*.
- **Table rename / remove / reorder**, and a per-analysis main-table **picker UI**.
- **A deeper join right-sub-pipeline editor** (the right side carrying its own reduce/collapse) — engine-supported, deferred; v1 wires the table as-is.

## 11. Risks

- **Broad read-site migration.** Many places read the three single-table atoms. Mitigation: the two derived "active table" helpers (§4.1) keep most call sites a one-line change, and the split (Data-tab vs. analysis) is mechanical and type-checked.
- **Large tables inlined on save.** A self-contained file embeds full rows; big right tables make big files. Accepted (matches today's inline-join behavior); de-duplication keeps it to one copy per table.
- **Materialization latency.** Fetching a full table per join before analyze adds a round trip. Mitigation: cache the materialized table by `(tableId, handle.version)` so an unedited table is fetched once.
