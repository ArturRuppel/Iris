# Transformation Workbench — Connection Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workbench DAG author-able by direct manipulation. Every data node gains a `+` on its output side: **click** it for a phase-keyed menu of every operation that fits here and splice a blank step in; **drag** it onto another data node to wire a binary op (`join`). A step that still needs an input renders that input as an **open "missing" circle** to be filled by a drag. Inserting mid-pipeline is the same gesture as appending (a node's `+` adds *after* it, splicing if a downstream neighbor exists). This closes the create-side authoring-parity gap in `TODO.md`.

**Design:** `docs/superpowers/specs/2026-06-27-workbench-connection-authoring-design.md`.

**Architecture:** Three waves. **Wave 1 (state + pure logic)** extends `makeStep` to all seven reduce kinds, adds `insertStepAtom`, fixes the `reduce.post`-drop bug across all five step writers, and adds a pure phase→affordances resolver (its own new file). **Wave 2 (graph model)** teaches `buildGraph` to emit an unfilled join's right input as a `missing` placeholder node (the open circle) and surfaces that flag to the node component. **Wave 3 (canvas wiring)** makes the `+` handle interactive and implements the click-menu / drag-to-node gestures on `WorkbenchCanvas`, routing every gesture through the Wave-1 atoms.

**Tech Stack:** TypeScript, React 18.3, Jotai, `@xyflow/react` 12, Vitest 4 + @testing-library/react (jsdom).

**Invariants (do not violate):**
- **The graph is a derived view.** A `+`-gesture NEVER adds a React Flow edge directly — it calls a spec-mutating atom; the edge appears when `buildGraph` re-derives. No `onConnect`-adds-edge.
- Nothing about cards/layout/positions/selection/the `+` is serialized — session-only Jotai only.
- No legacy/back-compat: when a path is replaced, delete the old one (Iris has no users).
- Pure logic (`makeStep`, the phase resolver, `isValidConnection`, `buildGraph`) reads no atoms and is unit-tested directly — React Flow drag/connect events do not fire under jsdom, so handlers delegate to pure reducers tested in isolation (as `applyNudge` already is).
- **No engine or `.iris` change.** Every kind this authors already exists in the engine and the format.
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017eSJF9bsHq4JiSyLbe78uM
  ```

**Resolved decisions (from the spec's §9; baked in here):**
1. **One `+` per node**, opening a single phase-keyed menu (not one `+` per option).
2. **Join v1 wires the target node's table as-is** into `join.right`; a deeper right-sub-pipeline editor is a later follow-up.
3. **The on-canvas `+` supersedes `TableCard`'s in-card `+ Filter / Drop` menu** — one obvious way to add a step (Task 8 removes the in-card menu).

**Blank-step shapes `makeStep` must produce (all valid, minimal):**
```ts
drop:          { kind:"drop", columns:[] }                       // exists
filter:        { kind:"filter", conditions:[] }                  // exists
derive:        { kind:"derive", column:"", expr:"" }
recode:        { kind:"recode", column:"", map:{} }
pivot:         { kind:"pivot", index:[], column:"", values:"", agg:"sum", fill:0, names:{} }
grid_complete: { kind:"grid_complete", by:[], column:"", levels:[], count:true,
                 count_unique:null, fill:0, count_name:"n" }
join:          { kind:"join", on:[], how:"inner", right: EMPTY_RIGHT }  // see below
```
`EMPTY_RIGHT = { schema: { columns: [] }, rows: [] }` is the **unfilled sentinel**: a `join` whose `right.schema.columns.length === 0` is "missing its right input". The run path must skip it (don't POST an under-specified join to `/reduce`); the graph renders its right input as the open circle.

---

## Wave 1 — state + pure logic (SEQUENTIAL within `state.ts`; Task 3 is a disjoint new file)

### Task 1: `makeStep` builds valid blanks for all seven kinds

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

- [ ] **Step 1 — failing test.** In `state.test.ts`, for each kind in `["derive","recode","pivot","grid_complete","join"]`, assert `makeStep(kind).kind === kind` and that the returned object matches the blank shape above (e.g. `makeStep("pivot")` has `agg:"sum"`, `fill:0`, `names:{}`; `makeStep("join").right.schema.columns` is `[]`). Assert every result carries a `_key` (from `nextStepKey()`).
- [ ] **Step 2 — run, verify fail** (`npx vitest run src/state.test.ts`).
- [ ] **Step 3 — implement.** Extend `makeStep` to a `switch (kind)` returning the blanks above (keep `_key: nextStepKey()` on each). Export `EMPTY_RIGHT` (or an inline literal) for reuse by the run-skip guard in Task 7.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): makeStep builds valid blanks for all seven reduce kinds`).

### Task 2: `insertStepAtom` + preserve `reduce.post` across every writer

**Files:** Modify `src/state.ts`, `src/state.test.ts`.

**Context.** `ReduceSpec = { steps; post? }`. Today `addStepAtom`/`updateStepAtom`/`removeStepAtom`/`moveStepAtom` rebuild `reduce` as `{ steps }`, silently dropping `post` (TODO correctness bug). The fix: spread `...p.reduce` in all of them. `insertStepAtom` is new and splices.

- [ ] **Step 1 — failing test.** (a) Seed an active plottable whose `reduce = { steps:[A,B], post:[P] }`. Call each of `addStepAtom("drop")`, `updateStepAtom({index:0,step:A2})`, `removeStepAtom(1)`, `moveStepAtom({index:0,dir:1})` and assert `reduce.post` is still `[P]` after each. (b) `insertStepAtom({ afterIndex:0, kind:"filter" })` on `steps:[A,B]` → `steps` is `[A, <filter>, B]` (length 3, new step at index 1). (c) `insertStepAtom({ afterIndex:1, kind:"drop" })` appends after the last → `[A,B,<drop>]`.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Add `insertStepAtom = atom(null, (get,set,{afterIndex,kind}) => …)`: `const steps=[...p.reduce.steps]; steps.splice(afterIndex+1,0,makeStep(kind)); set(active,{...p, reduce:{...p.reduce, steps}})`. In all four existing writers replace `reduce: { steps: … }` with `reduce: { ...p.reduce, steps: … }`. (`addStepAtom` may stay as append, or become `insertStepAtom` with `afterIndex = steps.length-1` — keep it as the explicit append entry point.)
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`fix(workbench): preserve reduce.post in step writers; add insertStepAtom`).

### Task 3: pure phase→affordances resolver + `isValidConnection`

**Files:** Create `src/workbench/authoring.ts`, `src/workbench/authoring.test.ts`.

**Context.** A node's pipeline phase is derivable from its id/kind (`graph.ts`): `source` / `step:i` → **reduce**; `grain:…` → **grain**; `source:i` → **join-input**; `plot`/`stats` → **terminal**. The resolver maps a node to the menu shown at its `+`, and to what each pick mutates. `isValidConnection` decides which target nodes light up during a drag (v1: only the binary `join`).

```ts
export type AuthorAction =
  | { kind: "reduce"; step: ReduceStepKind }   // insertStepAtom after this node
  | { kind: "collapse" }                        // begin/extend collapse
  | { kind: "geom" }                            // add layer → plot
  | { kind: "test" };                           // add test → stats
export interface AuthorOption { label: string; action: AuthorAction }
export function affordances(node: ExplorerNode): AuthorOption[]
export function isValidDropTarget(sourceId: string, target: ExplorerNode): boolean
```

- [ ] **Step 1 — failing test.** `affordances` for a `source`/`step:i` node returns all seven reduce kinds plus `collapse`, `geom`, `test`. For a `grain:…` node returns `collapse`, `geom`, `test` (no reduce kinds). For `plot`/`stats` returns `[]`. `isValidDropTarget("step:0", <a table node "step:1">)` is `true`; against a `plot`/`stats` node is `false`; against itself is `false`.
- [ ] **Step 2 — run, verify fail** (`npx vitest run src/workbench/authoring.test.ts`).
- [ ] **Step 3 — implement.** A `phaseOf(id)` helper (mirror `ArrayShapeRFNode.variantOf` / `graph.ts` id conventions) → switch to the option lists above. `isValidDropTarget`: `target.kind === "table" && target.id !== sourceId` (v1 = join only; terminals excluded by `kind`).
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): pure phase→affordances + drop-target resolver`).

---

## Wave 2 — graph model (the open-circle node)

### Task 4: `buildGraph` emits an unfilled join's right input as a `missing` placeholder

**Files:** Modify `src/explorer/graph.ts`, `src/explorer/graph.test.ts`; modify `src/workbench/ArrayShapeRFNode.tsx`, `src/workbench/ArrayShapeRFNode.test.tsx`.

**Context.** `buildGraph` already emits, for each `join` step, a second input node `source:${i}` and a convergent edge into the step node. When `right` is the empty sentinel, that input is *unfilled* — model it as the open circle by flagging the node `missing: true` and labelling it a drop target, reusing the existing convergent-edge topology (no second handle invented).

- [ ] **Step 1 — failing test.** Build a graph from a single `join` step whose `right = EMPTY_RIGHT`. Assert the `source:0` node exists, carries a truthy `missing` flag, and its label invites a drop (e.g. `"drop a table here"`). Build the same with a *filled* `right` (1+ columns) → `missing` is falsy and the label is the value-column summary (unchanged from today).
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** In the `join` branch of `buildGraph`, compute `const filled = step.right.schema.columns.length > 0;`. For the `source:i` node set `missing: !filled` and, when unfilled, `label: "drop a table here"`. Add `missing?: boolean` to `ExplorerNode`. (The convergent edge stays; optionally tag it so the edge can render dashed when unfilled — label logic unchanged.)
- [ ] **Step 4 — surface the flag to the node component.** In `ArrayShapeRFNode.tsx`, extend `nodeShapeProps` to pass `missing` through, and render the left/target handle as an **open circle** (visible, distinct class e.g. `txw-handle-missing`) when `missing`, instead of the `opacity:0` handle. Add a test: `nodeShapeProps({…missing:true})` carries the flag; the rendered node exposes the missing-handle class.
- [ ] **Step 5 — run, verify pass** (`npx vitest run src/explorer/graph.test.tsx src/workbench/ArrayShapeRFNode.test.tsx`).
- [ ] **Step 6 — commit** (`feat(workbench): unfilled join right input renders as an open "missing" node`).

---

## Wave 3 — canvas wiring (SEQUENTIAL; touches `ArrayShapeRFNode` + `WorkbenchCanvas`)

### Task 5: the interactive `+` handle + the phase-keyed add menu

**Files:** Modify `src/workbench/ArrayShapeRFNode.tsx`; create `src/workbench/AddStepMenu.tsx` + test; modify `src/workbench/WorkbenchCanvas.tsx`, `src/workbench/WorkbenchCanvas.test.tsx`.

**Context.** Today the right/source handle is `opacity:0`. Make it a visible `+`. Clicking it opens a small popover listing `affordances(node)`; picking a reduce option calls `insertStepAtom({ afterIndex: stepIndexOf(node), kind })`; picking collapse/geom/test calls the existing terminal atoms (`setCollapsePlanAtom` / `addLayerAtom` / the test-select atom). `afterIndex` for a `source`/`step:i` node is `i` (Source = `-1` → insert at 0). The menu is the same component used on drop-to-empty-canvas in Task 6.

- [ ] **Step 1 — failing test for `AddStepMenu`.** Pure component: `<AddStepMenu options={affordances(stepNode)} onPick={spy} />` renders one button per option (all seven reduce kinds for a step node) and calls `onPick(option.action)` on click. (Reuse `TableCard`'s `KIND_LABEL` map for reduce labels.)
- [ ] **Step 2 — run, verify fail; implement `AddStepMenu`** (a plain list-of-buttons popover; no atoms).
- [ ] **Step 3 — failing test for the dispatch reducer.** Export a pure `applyAuthorAction(set, node, action)` (or a reducer returning the atom-call descriptor) from `WorkbenchCanvas`. Assert: a `{kind:"reduce",step:"derive"}` action on `step:1` resolves to `insertStepAtom({afterIndex:1, kind:"derive"})`; on `source` resolves to `afterIndex:-1` (→ inserts at 0); a `{kind:"geom"}` action resolves to the layer-add atom. (Test the descriptor/dispatch purely — RF click won't fire in jsdom.)
- [ ] **Step 4 — run, verify fail; implement the `+` handle + wiring.** In `ArrayShapeRFNode`, render the source handle as a visible `+` (class `txw-handle-add`) that opens `AddStepMenu` (local state for open/anchor) seeded with `affordances(node)`; `onPick` → `applyAuthorAction`. In `WorkbenchCanvas`, provide the dispatch (it has the atom setters) and `afterIndex` resolution.
- [ ] **Step 5 — run, verify pass.**
- [ ] **Step 6 — commit** (`feat(workbench): interactive + handle opens the phase-keyed add menu`).

### Task 6: drag-to-node → join; drop-on-canvas → menu; fill the open circle

**Files:** Modify `src/workbench/WorkbenchCanvas.tsx`, `src/workbench/WorkbenchCanvas.test.tsx`.

**Context.** Wire React Flow's `onConnectStart` / `isValidConnection` / `onConnectEnd` (NOT `onConnect`). `isValidConnection` defers to `isValidDropTarget`. `onConnectEnd` branches on the drop:

- **on a fitting data node B** (from source A's `+`) → create a `join`: `insertStepAtom({ afterIndex: stepIndexOf(A), kind:"join" })` then set its `right` to B's table (v1: B's table as-is — fetch/reuse the reduce preview for B's node). Pure reducer: `connectionToJoin(graphAtomState, aId, bId) → { afterIndex, rightNodeId }`.
- **on an open-circle (`missing`) node** → fill that existing join's `right` from the dragged source node's table (no new step). Reducer: `fillMissingRight(joinSourceNodeId, fromNodeId)`.
- **on empty canvas / non-fitting** → open `AddStepMenu` at the drop point for source A (identical to click `+`), or cancel.

- [ ] **Step 1 — failing test (pure reducers).** `isValidConnection`-style guard rejects a drop on a `plot` node and on the source itself, accepts a drop on another table node. `connectionToJoin(graph, "step:0", "step:1")` returns `{ afterIndex:0, rightNodeId:"step:1" }`. `fillMissingRight` maps `(missingNodeId="source:2", fromNodeId="grain:cell")` to `{ joinIndex:2, fromNodeId:"grain:cell" }`.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Add the three pure reducers + the `onConnectStart/isValidConnection/onConnectEnd` handlers delegating to them, then calling `insertStepAtom` + the join-`right`-set (extend `updateStepAtom` usage, or a small `setJoinRightAtom({ index, right })`). Resolve a node's table to a `Table` via the existing reduce-preview atoms (as `NodeTable` does). Highlight valid targets during drag via a CSS class toggled from `onConnectStart` state.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(workbench): drag + to a node creates/fills a join; drop on canvas opens the menu`).

### Task 7: skip under-specified joins on the run path

**Files:** Modify the reduce/analyze request builder (grep `EMPTY_REDUCE` / where `reduce.steps` is serialized for `/reduce`), + its test.

**Context.** A freshly created `join` carries the empty-`right` sentinel until filled. It must not be POSTed to the engine (it would error). Strip/skip any `join` with `right.schema.columns.length === 0` when building the engine request (display only — the spec keeps the step so the editor and open circle persist).

- [ ] **Step 1 — failing test.** A spec with `steps:[filter, join(EMPTY_RIGHT)]` produces an engine request whose steps exclude the unfilled join (and include it once `right` has columns).
- [ ] **Step 2 — run, verify fail; implement** the skip at the request-build seam (a `.filter(s => s.kind!=="join" || s.right.schema.columns.length>0)` at serialization, with a one-line comment).
- [ ] **Step 3 — run, verify pass; commit** (`feat(workbench): skip unfilled joins when building the engine request`).

### Task 8: remove `TableCard`'s superseded in-card add menu

**Files:** Modify `src/workbench/cards/TableCard.tsx`, `src/workbench/cards/TableCard.test.tsx`.

**Context.** Decision 3: the on-canvas `+` is the single way to add a step. Drop `TableCard`'s `+ Filter / Drop` menu (and its `adding` state); the card becomes the node's table view only (`<NodeTable node={node} />`).

- [ ] **Step 1 — update the test** to assert the table renders and the in-card add-step button is **gone**.
- [ ] **Step 2 — run, verify fail; implement** (delete the menu + `addStepAtom` import + `adding` state).
- [ ] **Step 3 — run, verify pass; commit** (`refactor(workbench): TableCard is table-only; + handle owns add-step`).

---

## Done criteria
- Every data node shows a `+`; clicking it lists exactly the phase-appropriate options (`affordances`) and splicing/append lands the step at the right index (`insertStepAtom`).
- Dragging a node's `+` onto another data table creates a `join` wired to that table; dragging onto an unfilled join's open circle fills its right input; dropping on empty canvas opens the add menu.
- A `join` with an unfilled right renders an open "missing" circle and is **never** sent to the engine.
- `reduce.post` survives every step edit (the silent-drop bug is fixed).
- No React Flow edge is ever added directly — every gesture mutates the spec and the graph re-derives.
- `npm test -- --run`, `npx tsc --noEmit`, `npm run build` all green; nothing session-only is serialized; no dead code remains (`TableCard` menu removed, no `StubBody`).

## Out of scope (tracked follow-ups, per the spec §10)
- `location`/`rate` test-picker controls; post-collapse (`reduce.post`) step *authoring* UI (this plan only *preserves* `post`); a deeper join right-sub-pipeline editor; persisting layout to `.iris`.
