# Transformation Workbench Phase 4b — the three real cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the last three workbench stub cards (`table`, `op-editor`, `test-editor`) with real editors so every clickable node/edge opens a working surface.

**Architecture:** Two waves. **Wave 1** builds five *leaf* reduce-step editors (`derive`/`recode`/`join`/`pivot`/`grid_complete`) — each a pure, self-contained `{ step, columns, onChange }` component in its **own new file**, mirroring the existing `StepFilter` pattern, touching **no shared file**. These five are dispatched in parallel (disjoint files → no conflicts). **Wave 2** is three sequential integration tasks that each touch the shared `cardRegistry.tsx`: the `OpEditorCard` dispatcher (routes an edge → step index → the right editor), the `TableCard` (extract a reusable `NodeTable` from `DataTab`), and the Stats/Test split (`StatsPanel` → result-only `StatsResults` + picker-only `TestPicker`; `StatsCard` shows results, new `TestCard` shows the picker).

**Tech Stack:** TypeScript, React 18.3, Jotai, Vitest 4 + @testing-library/react (jsdom).

**Invariants (do not violate):**
- Nothing about cards/layout/positions/selection is serialized — session-only Jotai only.
- No legacy/back-compat: when a path is replaced, delete the old one (Iris has no users).
- Each editor is **pure**: it receives `{ step, columns, onChange }` and calls `onChange` with the next step. It reads no atoms. Persistence is the parent card's job (`updateStepAtom`).
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VoR6UvzPXR5gYDeVpAVyiM
  ```

**Reference — the pattern every Wave-1 editor mirrors (`src/components/StepCards.tsx`, `StepFilter`):**
```tsx
export function StepFilter(
  { step, columns, onChange }:
  { step: FilterStep; columns: ColumnDef[]; onChange: (s: FilterStep) => void },
) {
  const conds = step.conditions;
  const set = (i, patch) => onChange({ ...step, conditions: conds.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  // …controls call onChange({ ...step, <field>: next })…
}
```
`ColumnDef = { name: string; type: "numeric"|"categorical"|"identifier"|"bool"; label: string; unit?; levels?: string[]; labels? }`.

---

## Wave 1 — five leaf step editors (PARALLEL; disjoint new files)

Each task creates exactly two new files and edits nothing else. Each editor is pure (`{ step, columns, onChange }`), follows the `StepFilter` pattern, and labels every control. Where a step field is fixed by the type (e.g. `how: "inner"`, `agg: "sum"`), render it as static read-only text — do not offer a control for it. Use existing CSS classes where natural (`step-meta`, `filter-row`, `step-add-row`, `icon`); no new CSS required.

### Task 1: StepDerive

**Files:**
- Create: `src/components/StepDerive.tsx`
- Test: `src/components/StepDerive.test.tsx`

**Type:** `DeriveStep { kind: "derive"; column: string; expr: string; _key? }` — `column` is the *new* column's name; `expr` is the formula.

- [ ] **Step 1 — failing test.** Render `<StepDerive step={{kind:"derive",column:"ratio",expr:"a/b"}} columns={cols} onChange={spy} />`. Assert both current values appear (a name input with value `ratio`, an expr input with value `a/b`). Fire change on the expr input to `a/c` → `spy` called with `{kind:"derive",column:"ratio",expr:"a/c"}`. Fire change on the name input to `r2` → `spy` called with `column:"r2"`.
- [ ] **Step 2 — run, verify fail** (`npx vitest run src/components/StepDerive.test.tsx`).
- [ ] **Step 3 — implement.** Two labelled text inputs: "New column" (`column`) and "Expression" (`expr`). Each `onChange` → `onChange({ ...step, column|expr: e.target.value })`. A one-line `step-meta` hint, e.g. `new column “{column||"…"}” = {expr||"…"}`.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): StepDerive editor`).

### Task 2: StepRecode

**Files:**
- Create: `src/components/StepRecode.tsx`
- Test: `src/components/StepRecode.test.tsx`

**Type:** `RecodeStep { kind: "recode"; column: string; map: Record<string,string>; _key? }` — relabel values of `column` via a from→to map.

- [ ] **Step 1 — failing test.** Render with `{kind:"recode",column:"cond",map:{"0":"ctrl"}}` and `cols` containing a `cond` column. Assert a column `<select>` with value `cond`, and one mapping row showing key `0` and value `ctrl`. (a) Change the value input to `control` → `spy` called with `map:{"0":"control"}`. (b) Click "+ mapping" → `spy` called with an extra blank entry. (c) Change the `<select>` to another column → `spy` with new `column`. (d) Remove the row → `spy` with `map:{}`.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** A column `<select>` (options from `columns`, by `name`/`label`). Below it, one row per `[from,to]` entry of `map`: a `from` key input, a `to` value input, a remove `✕` button (class `icon`). A "+ mapping" button (class `step-add-row`) appends a `["",""]` entry. Editing a key rewrites the map preserving order (rebuild the object from the row list so renames don't collide). Editing a value sets `map[from]=to`. Keep the rows as an ordered array derived from `Object.entries(step.map)` and re-serialise on every change.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): StepRecode editor`).

### Task 3: StepJoin

**Files:**
- Create: `src/components/StepJoin.tsx`
- Test: `src/components/StepJoin.test.tsx`

**Type:** `JoinStep { kind: "join"; on: string[]; how: "inner"; right: Table; _key? }` where `Table = { schema: Schema; rows: Row[] }`. `right` carries embedded data — it is **not** editable here; show it read-only. `how` is fixed `"inner"` — static text.

- [ ] **Step 1 — failing test.** Render with `on:["id"]`, `how:"inner"`, and a `right` table whose schema has 3 columns and `rows` of length 5. (a) Assert a read-only summary like `right table · 5 rows · 3 columns` and the word `inner`. (b) Assert the join-key picker shows the left `columns`; the box for `id` is checked. (c) Toggle another column on → `spy` called with `on:["id","<other>"]`. (d) Untoggle `id` → `spy` with `on` excluding `id`.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** A read-only header line: `right table · {right.rows.length} rows · {right.schema.columns.length} columns`, and `join type: inner` as static text. A checkbox list over `columns` (left side) for the `on` keys; toggling adds/removes the column `name` in `on` (preserve `columns` order). No editing of `right`/`how`. A `step-meta` hint when `on` is empty (`pick at least one join key`).
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): StepJoin editor (keys editable, right table read-only)`).

### Task 4: StepPivot

**Files:**
- Create: `src/components/StepPivot.tsx`
- Test: `src/components/StepPivot.test.tsx`

**Type:** `PivotStep { kind:"pivot"; index: string[]; column: string; values: string; agg:"sum"; fill: number; names: Record<string,string>; _key? }`. `agg` fixed `"sum"` (static text).

- [ ] **Step 1 — failing test.** Render with `index:["cell"]`, `column:"cond"`, `values:"val"`, `agg:"sum"`, `fill:0`, `names:{}` and `cols` containing those columns. (a) Change the `column` `<select>` → `spy` with new `column`. (b) Change the `values` `<select>` → `spy` with new `values`. (c) Change the `fill` number input to `1` → `spy` with `fill:1` (a `number`, not a string). (d) Toggle an `index` column → `spy` with updated `index`. Assert `sum` shown as static text.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Controls: `index` = checkbox list over `columns`; `column` = `<select>`; `values` = `<select>`; `agg` = static `sum`; `fill` = `<input type="number">` writing `Number(e.target.value)` (empty → `0`); `names` = ordered from→to rows like StepRecode ("relabel pivoted columns", + add / remove). Each control → `onChange({ ...step, <field>: next })`.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): StepPivot editor`).

### Task 5: StepGridComplete

**Files:**
- Create: `src/components/StepGridComplete.tsx`
- Test: `src/components/StepGridComplete.test.tsx`

**Type:** `GridCompleteStep { kind:"grid_complete"; by: string[]; column: string; levels: string[]; count: boolean; count_unique?: string|null; fill: number; count_name: string; _key? }`.

- [ ] **Step 1 — failing test.** Render with `by:["cell"]`, `column:"cond"`, `levels:["a","b"]`, `count:true`, `count_unique:null`, `fill:0`, `count_name:"n"` and matching `cols`. (a) Toggle the `count` checkbox → `spy` with `count:false`. (b) Change `count_name` input → `spy` with new value. (c) Change `column` `<select>` → `spy`. (d) Edit the `levels` (comma field) to `a,b,c` → `spy` with `levels:["a","b","c"]`. (e) Change `count_unique` `<select>` from "— none —" to a column → `spy` with `count_unique:"<col>"`.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Controls: `by` = checkbox list over `columns`; `column` = `<select>`; `levels` = a comma-separated text input (`split(",").map(trim).filter(Boolean)`); `count` = checkbox; `count_unique` = `<select>` with a leading `— none —` option (value `""` → `null`) then `columns`; `fill` = number input (`Number`); `count_name` = text input. Each → `onChange({ ...step, <field>: next })`.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): StepGridComplete editor`).

---

## Wave 2 — integration (SEQUENTIAL; each touches cardRegistry.tsx)

### Task 6: OpEditorCard — route an edge to its step editor

**Files:**
- Create: `src/workbench/cards/OpEditorCard.tsx`
- Create: `src/workbench/cards/OpEditorCard.test.tsx`
- Modify: `src/workbench/cardRegistry.tsx` (`"op-editor": OpEditorCard`; the `stub("op-editor")` entry goes away)
- Modify: `src/workbench/cardRegistry.test.tsx` (move `op-editor` out of the "stubs" assertion into the real-bodies assertion)

**Context.** Reduce-step edges are built in `src/explorer/graph.ts` as `{ id: "e:<from>-><to>", kind: step.kind, fromId, toId }` where the step node id is `toId = "step:<index>"`. The active analysis's steps live on `activePlottableAtom` (`.reduce.steps`); edit a step with `updateStepAtom({ index, step })`. Input columns at step *i* = the previous step's `schema_out` from the live reduce trace (`reducePreviewAtom.trace[i-1].schema_out.columns`), or `schemaAtom.columns` for `i===0` — exactly as `PipelineSection.inputColumnsFor` does it.

- [ ] **Step 1 — failing test for the pure resolver.** In `OpEditorCard.test.tsx`, import a pure `edgeIdToStepIndex(graph, edgeId)` (export it from `OpEditorCard.tsx`). Build a small `ExplorerGraph` with one step edge whose `toId` is `step:2`. Assert `edgeIdToStepIndex(graph, "<that id>") === 2`, and that a non-step edge id and an unknown id both return `null`.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement the resolver.** `export function edgeIdToStepIndex(graph: ExplorerGraph, edgeId: string): number | null` — find the edge by id; `m = /^step:(\d+)$/.exec(edge.toId)`; return `m ? Number(m[1]) : null`; `null` if no edge.
- [ ] **Step 4 — failing test for the card.** Use `seedStore()` from `../cards/cardTestStore` style (see existing `StatsCard.test.tsx`/`AnnotateCard.test.tsx`); set the active plottable to one whose `reduce.steps = [aFilterStep]` so `explorerGraphAtom` yields a `filter` step edge. Render `<Provider store={store}><OpEditorCard target={{kind:"edge", id:<filterEdgeId>}} /></Provider>`. Assert the filter editor renders (e.g. a `+ condition` button is present). Add a condition / change one and assert `store.get(activePlottableAtom)!.reduce.steps[0]` reflects the edit. (Resolve the edge id by reading `explorerGraphAtom` in the test.)
- [ ] **Step 5 — run, verify fail.**
- [ ] **Step 6 — implement the card.** `OpEditorCard({ target }: CardBodyProps)`: read `explorerGraphAtom`, `activePlottableAtom`, `reducePreviewAtom`, `schemaAtom`. Compute `index = edgeIdToStepIndex(graph, target.id)`. If no active/graph or `index == null` or `index >= steps.length`, render a small `txw-card-stub`-style notice (`This step is no longer in the pipeline.`). Otherwise compute `cols = inputColumnsFor(index)` (copy the trace logic), `step = steps[index]`, and a single `onChange = (s) => updateStep({ index, step: s })`. Switch on `step.kind` to render: `drop`→`StepDrop`, `filter`→`StepFilter` (from `../../components/StepCards`); `derive`→`StepDerive`, `recode`→`StepRecode`, `join`→`StepJoin`, `pivot`→`StepPivot`, `grid_complete`→`StepGridComplete` (each from `../../components/Step*`). Wrap in `<div className="txw-card-op" data-testid="op-editor-card">`.
- [ ] **Step 7 — wire registry + fix its test.** In `cardRegistry.tsx` import `OpEditorCard` and set `"op-editor": OpEditorCard`. In `cardRegistry.test.tsx` move `"op-editor"` from the "keeps … as stubs" list into the real-bodies (`name !== "StubBody"`) list.
- [ ] **Step 8 — run full file + tsc** (`npx vitest run src/workbench/cards/OpEditorCard.test.tsx src/workbench/cardRegistry.test.tsx && npx tsc --noEmit`).
- [ ] **Step 9 — commit** (`feat(workbench): OpEditorCard routes step edges to their editors`).

### Task 7: TableCard — extract NodeTable from DataTab

**Files:**
- Create: `src/components/NodeTable.tsx` (the fetch + grid, extracted)
- Create: `src/components/NodeTable.test.tsx`
- Modify: `src/components/DataTab.tsx` (resolve the node, then delegate to `<NodeTable node={node} />` — DRY, delete the duplicated fetch/render)
- Create: `src/workbench/cards/TableCard.tsx`
- Create: `src/workbench/cards/TableCard.test.tsx`
- Modify: `src/workbench/cardRegistry.tsx` (`"table": TableCard`)
- Modify: `src/workbench/cardRegistry.test.tsx` (move `table` into the real-bodies list)

**Context.** `DataTab` currently (a) resolves which `ExplorerNode` to show (`selectedNodeIdAtom` → fallback to the plot node) and (b) fetches/renders that node's table via `engine.reduce(...)` with `node.table.via` ∈ `at_step|level|none`. Split (a) from (b): `NodeTable` takes the already-resolved node and does only (b). The engine fetch is hard to exercise under jsdom — test the **selection/branching** and the **add-step** behaviour, not a live network fetch.

- [ ] **Step 1 — extract NodeTable (no behaviour change).** Create `NodeTable({ node }: { node: ExplorerNode })` holding DataTab's existing fetch effect + loading/error/`via:"none"` branches + `<Grid>` render verbatim (move, don't rewrite). Reduce `DataTab` to: resolve `node` (unchanged logic), `if (!active || !node) return <…Building preview…>;` then `return <NodeTable node={node} />;`.
- [ ] **Step 2 — DataTab still green.** Run DataTab's existing test file (if present) + `npx tsc --noEmit`. Expected: PASS (pure refactor).
- [ ] **Step 3 — failing test for NodeTable's no-fetch branches.** With no `tableHandleAtom` set, a node with `table.via:"at_step"` renders a loading/`Building preview…` state (no crash). A node with `table.via:"none"` and a seeded `reducePreviewAtom` renders the grid. (Match how existing DataTab tests seed atoms; don't mock the network.)
- [ ] **Step 4 — run, verify fail; implement until pass** (mostly already satisfied by the move — adjust NodeTable so the branches are reachable with the resolved node prop).
- [ ] **Step 5 — failing test for TableCard.** `seedStore()`; set the active plottable so `explorerGraphAtom` yields a known table node (e.g. the `source` node id). Render `<Provider store={store}><TableCard target={{kind:"node", id:"source"}} /></Provider>`. (a) Assert it renders without crashing (delegates to NodeTable). (b) Assert an add-step control exists; click "+ Filter" (or the menu's Filter) → `store.get(activePlottableAtom)!.reduce.steps.length` increased by 1 and the new step's `kind === "filter"`.
- [ ] **Step 6 — run, verify fail.**
- [ ] **Step 7 — implement TableCard.** `TableCard({ target }: CardBodyProps)`: read `explorerGraphAtom`; `node = graph?.nodes.find(n => n.id === target.id)`; if none → small notice. Else render `<div className="txw-card-table" data-testid="table-card"><NodeTable node={node} />` + an add-step menu mirroring `PipelineSection`'s (`adding` toggle; buttons for `drop`/`filter` calling `useSetAtom(addStepAtom)(kind)`; note this **appends** to the pipeline). Close the div.
- [ ] **Step 8 — wire registry + fix its test** (`"table": TableCard`; move `table` to real-bodies list).
- [ ] **Step 9 — run the touched test files + tsc.**
- [ ] **Step 10 — commit** (`feat(workbench): TableCard via extracted NodeTable + add-step menu`).

### Task 8: Stats/Test split — StatsCard shows results, TestCard shows the picker

**Files:**
- Modify: `src/components/StatsPanel.tsx` (extract two exported components: `StatsResults` = Result + per-group summary + Methods text; `TestPicker` = inferred model + describe-only + reference toggle + assumption checks + recommended test / `GuidedTestPicker`)
- Modify: `src/workbench/cards/StatsCard.tsx` (render `<StatsResults />`)
- Create: `src/workbench/cards/TestCard.tsx` (render `<TestPicker />`)
- Create: `src/workbench/cards/TestCard.test.tsx`
- Modify: `src/workbench/cardRegistry.tsx` (`"test-editor": TestCard`; **remove the now-unused `stub` factory** — all eight kinds are real)
- Modify: `src/workbench/cardRegistry.test.tsx` (move `test-editor` to real-bodies; the "keeps … as stubs" test now asserts an **empty** stub set — or delete it)
- Modify: `src/workbench/cards/StatsCard.test.tsx` if it asserted picker-only UI that now lives in TestCard

**Context.** `StatsPanel` is one component rendering both the test picker (interactive: inferred model, "Describe only", reference toggle, assumption checks, recommended-test chips / `GuidedTestPicker`) and the results (Result rows, per-group summary, Methods text + Copy). Both read the same atoms (`activePlottableAtom` + the analysis result). The split is by responsibility: results display vs test choice. Keep both reading the same atoms — no prop threading.

- [ ] **Step 1 — read StatsPanel fully**; identify the exact JSX boundary between picker and results (results begin at the `Result` `<h3>`). Confirm `StatsPanel`'s only importer is `StatsCard` (grep `StatsPanel`); if another importer exists, keep a thin `StatsPanel = <><TestPicker/><StatsResults/></>` for it, otherwise remove `StatsPanel`.
- [ ] **Step 2 — failing test for the split.** New `TestCard.test.tsx`: with an analysis result seeded so a test ran, render `<Provider store={store}><TestCard target={{kind:"edge",id:"t:test"}} /></Provider>` and assert a picker-only element is present (e.g. the "Describe only" checkbox) **and** that a results-only element (the "Methods text" heading) is **absent**. Add/extend `StatsCard.test.tsx` to assert the inverse (Methods/Result present, "Describe only" absent).
- [ ] **Step 3 — run, verify fail.**
- [ ] **Step 4 — implement the extraction.** Split `StatsPanel`'s body into `export function TestPicker()` (everything up to results) and `export function StatsResults()` (Result + per-group summary + Methods text + Copy). Both compute the same atom reads they need locally (duplicate the small `useAtomValue` lines rather than threading props). Replace `StatsCard` body with `<div className="txw-card-stats" data-testid="stats-card"><StatsResults /></div>`. Create `TestCard({}: CardBodyProps)` → `<div className="txw-card-test" data-testid="test-card"><TestPicker /></div>`.
- [ ] **Step 5 — run, verify pass.**
- [ ] **Step 6 — wire registry + cleanup.** `"test-editor": TestCard`; delete the unused `stub` factory and the `StubBody` references; update `cardRegistry.test.tsx` (test-editor → real; stub set now empty/deleted).
- [ ] **Step 7 — full suite + tsc + build** (`npm test -- --run && npx tsc --noEmit && npm run build`).
- [ ] **Step 8 — commit** (`feat(workbench): split Stats into result StatsCard + picker TestCard`).

---

## Done criteria
- `targetToCardKind` unchanged; `CARD_BODIES` has **zero** `StubBody` entries; `cardRegistry.test.tsx` reflects all eight kinds real.
- Clicking any node opens a table/plot/stats card; clicking any edge opens its editor (collapse/geom/annotate from Phase 4; op/test now real). Editing a step edge mutates `activePlottableAtom.reduce.steps`; editing the test picker mutates the analysis's test selection.
- `npm test -- --run`, `npx tsc --noEmit`, `npm run build` all green.
- Nothing session-only is serialized; no dead stub code remains.
