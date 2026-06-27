# Transformation Workbench — Connection Authoring

**Status:** Design (brainstorming, 2026-06-27)
**Builds on:** the transformation-workbench canvas (`2026-06-24-transformation-workbench-canvas-design.md`) — the read-only/edit-only DAG where clicking a node or edge opens a card.
**Closes:** the "GUI authoring parity — create the reduce-step kinds the engine already supports" gap in `TODO.md`, and gives a concrete UI answer to its two open sub-questions (append vs. insert-at-position; how `join` gets its right table).

---

## 1. Goal

Make the workbench DAG **author-able by direct manipulation**: every node carries a `+` on its output edge; clicking it adds a step *here*, dragging it connects *to* another node. Today the canvas can only *edit* a pipeline that already exists (every edge opens its editor) and can only *create* `filter`/`drop` (via the `TableCard` append menu). After this, the full reduce vocabulary and the terminal operations are buildable on the canvas with one uniform gesture.

One sentence: **a node's `+` means "add a transformation starting here" — click for a menu of everything that fits, drag to wire it into a specific node.**

## 2. The load-bearing constraint (inherited)

**The graph is a derived view, not the source of truth.** `buildGraph(...)` (`src/explorer/graph.ts`) is a pure projection of the spec (`reduce.steps`, `spine`, `collapse` plan, `layers`, `stats`). Nodes and edges are regenerated on every spec change; the only user state persisted across rebuilds is dragged **positions** (`nodePositionsAtom`). React Flow's own `onConnect` is **not** wired up.

Therefore a `+`-gesture **cannot add a React Flow edge directly**. It must emit a **spec mutation** (a new `ReduceStep`, a new collapse routing, a new layer, a test config), which re-derives the graph so the edge appears on the next render. The `+`-drag is an *authoring gesture that produces a spec edit*, not a free-form graph edit. Everything below follows from this.

## 3. Core principles

1. **One gesture, phase-aware target.** Every node has a single `+` on its output side. Clicking or dragging it always means "add a transformation immediately after this node." *What* you can add, and *which spec collection* the mutation lands in, depend on the node's pipeline phase (§5).
2. **Insert = append-after-predecessor.** There is **no separate "drop on an edge" affordance.** Inserting a step into the `A → B` edge is just `A`'s `+` ("add after A"). If `A` already has a downstream neighbor, the new step is *spliced* between them; if not, it is *appended*. Append and insert are the same operation at different positions.
3. **Click adds all-that-fit; drag wires to one.** Click `+` → a menu of every option valid at this phase → build a blank step → splice it in. Drag `+` → only nodes that can legally receive this connection highlight; drop on one wires them; drop on empty canvas is identical to click (create step + its new node).
4. **Drag-to-node is for binary ops.** Almost every reduce step is unary (one table in, one out), so dragging onto an *existing* node is only meaningful where two tables converge — i.e. **`join`** (the engine's one binary op; see the `source:${i}` second input in `buildGraph`). Dragging table A's `+` onto table B *is* the join's right-table picker (the `TODO`'s flagged "hard case").
5. **Missing inputs are open circles.** A step that needs an input it doesn't yet have (a fresh `join` with no right table) renders that input handle as an **unfilled "missing" circle**, prompting a drag to fill it. A step is not committed-as-runnable until its required inputs are satisfied; the graph degrades gracefully (the editor card opens, the engine isn't asked to run an under-specified step).
6. **Reuse the editors; this is the create half.** The seven reduce-step editor cards and the collapse/geom/test cards already exist and already edit. This work only adds *creation*; on create, the relevant editor card opens (append/insert-then-edit, mirroring today's append-then-edit in §6 of the canvas design).

## 4. The gestures, precisely

### 4.1 Click `+`
1. Resolve the source node's phase → the set of fitting options (§5).
2. Show a small menu at the `+` ("all the options").
3. On pick: `makeStep(kind)` (or the collapse/geom/test equivalent) builds a **blank, valid** instance; the mutation splices it after the source node's position.
4. The graph re-derives; the new edge's editor card opens.

### 4.2 Drag `+`
1. `onConnectStart` records the source node + its phase.
2. While dragging, `isValidConnection` highlights only nodes that can legally receive *this* connection (e.g. for a join drag, only other data tables; terminals never accept). Non-fitting nodes dim.
3. `onConnectEnd`:
   - **Dropped on a fitting node** → the binary mutation (join A with B): create the `join` step, set its `right` source to B's table. No menu — the target *is* the choice.
   - **Dropped on empty canvas** → identical to click `+`: open the all-options menu, create step + new node.
   - **Dropped on a non-fitting node / nowhere** → cancel.

### 4.3 Filling a missing input
A node with an unfilled required input renders that handle as an open circle. Dragging from a data node's `+` onto that open circle satisfies the input (e.g. wires the join's right table). This is the same drag machinery as 4.2, entered from the *target* side's missing handle.

## 5. Phase-awareness — the fitting options & mutation target

The `+` is uniform; the option set and the spec collection it writes to are not. A node's phase is already derivable from its id/kind in `graph.ts` (`source`, `step:i`, `grain:…`, `source:i`, `plot`, `stats`):

| Source node phase | Fitting options at its `+` | Mutation target |
|---|---|---|
| **Source / reduce-stage table** (`source`, `step:i`) | the 7 reduce kinds; *begin collapse*; *add geom → plot*; *add test → stats* | `reduce.steps` (splice at `i+1`); or transition into the collapse plan / layers / stats |
| **Grain node** (`grain:…`) | *collapse further*; *add geom → plot*; *add test → stats* | `collapse` plan; `layers`; `stats` |
| **Join right-input** (`source:i`) | (input only — its `+` is the missing-input circle until filled) | `join.right` of step `i` |
| **Plot / Stats terminal** | none (sinks emit no forward edge) | — |

So "the terminal operations also work like this" (collapse / geom / test) is realized by the same `+`: from a reduce table or grain node, the menu includes "collapse", "plot (geom)", and "stats (test)" alongside the reduce kinds, each routing to its own collection. The existing collapse/geom/test editor cards open on create exactly as the reduce editors do.

## 6. New & changed code

### 6.1 New atoms / extended writers (`src/state.ts`)
- **`makeStep` → all seven kinds.** Today it builds only `drop`/`filter`. Extend to valid blank `derive`/`recode`/`pivot`/`grid_complete`, and a `join` whose `right` is **empty** (the missing-input state).
- **`insertStepAtom(afterIndex, kind)`** — new. Splices `makeStep(kind)` at `afterIndex+1` instead of appending. `addStepAtom` becomes the special case `insert at end`. (The `TODO` already anticipated "insert-at-position … needs a new atom".)
- **Preserve `reduce.post`** in `updateStepAtom` / `addStepAtom` / `insertStepAtom` / `removeStepAtom` / `moveStepAtom`. These currently rebuild `reduce` as `{ steps }`, silently dropping a loaded `post` phase (pre-existing correctness bug, tracked in `TODO.md`). This work touches all of them, so fix it here.
- **`join` right-source** — setting `join.right` from a dropped-on target node (its table at that grain becomes the right sub-pipeline source). The right side can itself carry `reduce` + `collapse` (the engine already supports this, per the COV2D §4 work) — v1 wires the target node's table as-is; a deeper right-sub-pipeline editor is a follow-up.

### 6.2 Canvas wiring (`src/workbench/`)
- **Visible `+` handles** on `ArrayShapeRFNode` output side (today's invisible `opacity:0` source handle becomes an interactive `+`). Multi-input nodes (join) gain a second target handle that renders **open** until filled.
- **`onConnectStart` / `isValidConnection` / `onConnectEnd`** in `WorkbenchCanvas` implementing §4. No `onConnect`-adds-edge — handlers call the atoms in §6.1.
- **The all-options menu** — a small phase-keyed popover (reuse `TableCard`'s `KIND_LABEL` map; it already lists all seven kinds). The `TableCard`'s in-card `+ Filter / Drop` menu is superseded by the on-canvas `+` (or kept as a redundant entry point — decide in planning).

## 7. Engine / spec changes

**None.** Every kind this authors already exists in the engine and the `.iris` format (the create-side parity gap is purely GUI). No new spec fields; no `.iris` migration. Canvas layout / `+` state stays session-only, consistent with the canvas design's "no layout in the spec" rule.

## 8. Testing strategy

- **Pure units (vitest):** `insertStepAtom` splices at the right index and preserves `post`; `makeStep` returns a valid blank for each of the seven kinds; phase → fitting-options resolver is a pure function and is table-tested.
- **Graph model:** after an insert, `buildGraph` emits the expected node/edge between the neighbors; a fresh `join` emits an open right-input node.
- **Interaction (RTL):** click `+` on a reduce table → menu shows all fitting kinds → pick `derive` → step appears + editor card opens. Drag table A's `+` onto table B → a `join` step is created with B as its right source. (React Flow drag events don't fire under jsdom — test the handler reducers directly, as `applyNudge` already is.)
- **E2E (Playwright):** build a two-step pipeline from `+` gestures and confirm the figure/stats recompute.

## 9. Open decisions (for planning)

1. **`+` count/placement** — one `+` per output handle, or a single `+` opening the phase menu? (Lean: single `+`, menu is phase-keyed.)
2. **Right-sub-pipeline depth for join v1** — wire the target table as-is (simple) vs. open the right side's own reduce/collapse editor immediately. Lean: as-is in v1; deeper editing is a follow-up.
3. **Keep or drop `TableCard`'s in-card add menu** once the on-canvas `+` ships (redundant entry point vs. one obvious way).
4. **Delete semantics** — out of scope here (this spec is create-only; edit/remove already exist via the edge cards), but worth confirming `removeStepAtom` re-stitches the chain cleanly when a *middle* step is removed.

## 10. Out of scope (separate follow-ups)

- **`location` / `rate` test-picker controls** — the second authoring-parity gap; its own slice.
- **Post-collapse (`reduce.post`) step authoring** — the third parity gap; this spec only *preserves* `post`, it does not add a UI to create post steps.
- **Free blank-whiteboard placement** — rejected by the canvas design; auto-layout stays.
- **Persisting `+`/layout state to `.iris`** — rejected; session-only.

## 11. Risks

- **Phase resolver drift** — the option set must stay in sync with what `buildGraph` and the engine actually accept at each phase. Mitigation: derive the resolver from the same phase signals `graph.ts` already uses; table-test it.
- **Under-specified steps reaching the engine** — a missing-input `join` must not be sent to `/reduce`. Mitigation: the run path skips steps with unfilled required inputs (graceful degrade), and the missing-input circle makes the gap visible.
- **Insert re-layout churn** — splicing a middle step re-flows the DAG and can move nodes the user nudged. Mitigation: reuse the existing structure-key re-layout (`WorkbenchCanvas`) which already re-seeds only on structural change.
