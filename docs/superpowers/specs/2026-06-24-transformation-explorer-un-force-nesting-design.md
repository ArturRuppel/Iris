# Transformation Explorer — Un-forcing the Nesting (Collapse Routing) — Design

> Sub-project 3 of the "part 3" explorer work. Turns the enforced, finest-first
> collapse **spine** into a per-analysis, editable **collapse plan** that
> *defaults* to today's chain, and replaces the pseudoreplication *wall* (there
> is no test-grain knob at all today) with a knob plus a tiered, never-blocking
> guard system. Follows the re-model
> (`2026-06-23-transformation-explorer-remodel-design.md`) and is independent of
> inline edge-editing (sub-project 2).

**Date:** 2026-06-24
**Status:** design, pending implementation plan

---

## Principle

Iris **guides and educates; the user is ultimately responsible.** The nesting
spine is a *default generated from column roles*, not a law. A given figure may
collapse its data differently — skip an intermediate median, keep a finer
coordinate while pooling a coarser unit, or test at a grain the author chooses —
and Iris's job is to make every consequence **legible** and to **warn loudly and
specifically** when a choice is a detectable integrity risk, never to refuse it.

Concretely this demotes two things that are "schema law" today:

1. **Roles → generator, not law.** Identifier/classifier roles (set on the data,
   table-level) still produce the canonical spine, but only as the *seed* of each
   analysis's collapse plan. Editing the plan does not rewrite the roles or touch
   any other analysis.
2. **The collapse chain → a removable default.** Today `buildGraph` draws a
   forced linear coarsest→finest chain off `hierarchy.spine`, and the test grain
   is *derived* (`coarsest_level` — the coarsest level any layer binds to). There
   is no control to do otherwise: the "wall" is the *absence of a knob* plus an
   auto-safe derivation. This sub-project adds the knob and the guards.

## Scope

- **In — A (re-route the collapse):** a per-analysis, ordered, editable collapse
  plan that may skip levels and pool a coarser unit while keeping a finer
  coordinate (the mean-trajectory case). Defaults to today's chain exactly.
- **In — C (choose the test grain):** an explicit per-analysis pointer to the
  node the test reads from, defaulting to the coarsest node (today's behavior).
- **In — the guard system:** four guards across two severities (below).
- **Deferred — B (branching):** more than one collapse path from one node (e.g.
  mean *and* median to the same grain on one plot). The model is *representable*
  (a node may carry multiple outgoing collapse edges) but this sub-project does
  not build branch-authoring UI or the plot-disambiguation channel a same-grain
  branch would need. No remodel required to add it later.
- **Deferred — edge-click editing:** sub-project 2 owns clicking a graph edge to
  edit it. This sub-project's editor is a dedicated panel; sub-project 2 later
  binds its gestures to the *same* atoms defined here.
- **Out — reordering the identity spine per analysis:** the nesting *order* is a
  data fact (you cannot sanely nest `cell` above `field`); it stays table-level
  in the existing HierarchyPanel. Per-analysis routing chooses *which* levels are
  collapse checkpoints and *in what order they are aggregated away*, not the
  containment order.

## The model

### Table-level (unchanged, now explicitly a generator)

`Hierarchy { spine: string[]; fn: Record<string, LevelFn> }` stays a property of
the **data** (one per table, derived from identifier roles). It defines
**containment/identity** (the full set, coarse→fine) and the default per-dim
aggregate. It is the seed the per-analysis default plan is generated from, and
nothing more.

### Per-analysis — the collapse plan (new)

A plan is an ordered list of **collapse steps**, each naming the grain it
produces (the dims it *keeps*) and the function that aggregates into it. **Raw is
a separate, always-present source node** (every reduced row); each step's source
is the previous step, and the first step's source is raw.

```
CollapseStep = { keep: string[]; fn: LevelFn }   // collapse to this grain (kept dims), aggregating with fn
CollapsePlan = CollapseStep[]                     // applied in order
```

- A step's **grain key** is its kept dims (spine order) joined by `/`; raw is `""`.
  Each step is a graph **node**.
- **The default plan is the full-spine prefix chain, finest→coarsest:** the first
  step keeps the *whole* spine (one row per finest level), and each next step
  drops the current finest dim, down to the coarsest single dim. Each step's `fn`
  is the table-level `fn` of its **finest kept dim**. This is precisely what
  `materialize_levels` builds today — so the default plan reproduces the forced
  chain **node-for-node and fn-for-fn** (the regression pin), and raw → per-finest
  is a real first collapse (raw is usually finer than the finest spine level).
- **The number of dims a step removes encodes the weighting.** Removing one dim
  per step is nested (median-of-medians, equal weight per parent). **Skipping** a
  level = a single step that removes two dims at once (the intermediate median is
  never taken — the finer units pool directly into the coarser grain). **Keeping
  a finer dim while dropping a coarser one** yields a non-prefix keep-set (the
  mean-trajectory grain).
- **Test grain (C)** is a pointer to one node's grain key. Default = the coarsest
  (last) step.

A plan is one linear list (branching deferred). Persisted **as-is** on the
analysis spec (see Persistence).

### Worked examples

Spine `experiment › field › cell › frame` (coarse→fine), all `median`.

- **Default (today):** plan keeps `[e,f,c,fr] → [e,f,c] → [e,f] → [e]` (full spine,
  then drop the finest dim each step; `experiment`, the root, stays as the final
  grain) → nodes `per frame → per cell → per field → per experiment`; test at
  `per experiment` (n = #experiments). Reproduces `materialize_levels` exactly.
- **Skip a level (A):** the step that would produce `per field` is dropped, so a
  single step goes `[e,f,c] → [e]` (removes `field` and `cell` together): cells
  pool straight to experiment. n is **identical** (still #experiments); only the
  *weighting* changes (a 100-cell field no longer counts equally with a 5-cell
  field — it now pools by cell). Not pseudoreplication — a weighting choice (white
  info).
- **Mean trajectory (A, keep-finer):** spine `experiment › cell › frame`, plan
  `[{keep:[e,c,fr]}, {keep:[e,fr]}]` → grain `(experiment, frame)`: the mean
  across cells at each timepoint. A non-prefix keep-set today's model cannot
  express.
- **Identity merge (the danger, guarded):** a step keeps `[e,c]` (drops `field`
  but keeps `cell`) → groups by `(experiment, cell)`. `cell_id` is unique only
  *within* a field, so cells sharing an id across fields **merge into one** —
  silent corruption. Yellow guard (#4) fires (a kept identifier `cell` is finer
  than the dropped `field` and loses distinctness).

## Engine

### `materialize_plan` — a general fold; `materialize_levels` delegates

Add a general fold `materialize_plan(df, schema, plan, split_cols)` that walks the
**CollapsePlan**: starting from raw, each step groups the *previous* table by its
`keep` dims (+ split) and aggregates with the step's `fn` — the existing
`_level_table` nesting logic, just driven by an explicit step list. Tables are
keyed by **grain key** (kept dims joined by `/`, `""` = raw).

`materialize_levels` becomes a thin adapter: it builds the default plan (via a
shared `default_plan(spine, fn)` helper — full-spine prefix chain, finest→coarsest,
`fn` per step from the finest kept dim) and re-keys the result by each grain's
finest dim, so its return shape — and **every existing caller's behavior** — is
byte-for-byte unchanged. That equivalence is the regression pin.

Node grains are now arbitrary spine **subsets** (e.g. `(experiment, frame)`), not
only prefixes. `resolve_level`/`coarsest_level` stay for the default path; the new
grain-keyed nodes are resolved directly by grain key.

### Guard helpers (pure, cheap — all from group counts)

Three new pure functions (siblings of `pairing`/`home_level`), each returning a
structured verdict the API surfaces and the frontend renders:

- **`pseudoreplication(df, plan, test_grain)` (#1):** the test node is finer than
  the coarsest available node ⇒ its units are nested within a coarser grain.
  Returns `{ risk, n_test, n_coarsest, coarsest_grain }` so the message can name
  the safer option and both n's.
- **`pairing_flip(df, spine, qualifier, default_grain, chosen_grain)` (#2):** run
  the existing `pairing()` (keyed by each grain's finest kept dim as the
  inferential level) under the default grain and the chosen grain; flag a verdict
  change (e.g. `paired → unpaired`) and which level the pairing was over.
- **`identity_merge(df, schema, spine, plan)` (#4):** for each step, the dims it
  removes from the previous grain. A removal of `D` merges identities **only when
  a kept dim finer than `D` is an `identifier`** (its labels may repeat across
  `D`) and its distinct-group count drops
  (`groupby(kept_ids).ngroups < groupby(kept_ids + [D]).ngroups`). Return the
  before/after counts and `D`. **Numeric/coordinate kept dims never trigger it**,
  and removing a dim with no finer kept identifier (the default chain, or pooling
  cells with nothing finer kept) is exempt — so only a genuine merge fires.

> **Interaction note (time-as-identifier):** the #4 coordinate exemption assumes
> a time/`frame` axis is *numeric*. A `frame` column mis-typed as `identifier`
> (the friction recorded in the sibling TODO item "Identifier default vs
> time-on-X") would trip #4 on the legitimate mean-trajectory case. That warning
> is then effectively a nudge to retype the column; the two items should be
> resolved together if the trajectory case is exercised.

### API

`/reduce` and `/shape_counts` already take a `hierarchy`; extend the request to
carry the per-analysis `collapse` plan and `test_grain`, and add the three guard
verdicts to the response (advisory chrome — a failed/in-flight guard call renders
no badge rather than blocking, same contract as the counts).

## Guard tiers (presentation)

Four guards, two severities, placed on the graph where the cause lives.
**Nothing ever blocks; there is no acknowledgment modal** — the figure and stats
always compute.

| guard | severity | placed on | message (specific, names the fix) |
| ----- | -------- | --------- | --------------------------------- |
| #1 pseudoreplication | **yellow** | test edge | "Testing at raw grain: 48 measurements from 6 experiments. The test treats correlated measurements as independent. Consider testing at 'per experiment' (n = 6)." |
| #2 pairing-flip | **yellow** | test edge | "This routing drops the 'experiment' level the pairing was over — the test is now unpaired." |
| #4 identity-merge | **yellow** | the merging collapse edge | "Collapsing out 'field' while keeping 'cell' merges 312 distinct cells into 47. Keep 'field', or collapse 'cell' too." |
| #3 flattening consequence | **white** | every collapse edge | always on: "median over the cells in each field; fields weight equally" (terse by default; full sentence on hover) |

Pseudoreplication gets the most pointed wording within the yellow tier (invalid
inference is the cardinal sin) but is the same severity — never a block. The
`stats` node carries an aggregate caution dot when any yellow guard is live on
its test path, so a re-route that quietly breaks inference is visible without
hunting. Badges are terse inline (icon + the count already shown); hover/click
expands to the full sentence with numbers.

## Frontend

### Collapse routing panel (new, per-analysis)

A dedicated panel in the analysis column (sibling to the layer controls),
independent of sub-project 2:

- The ordered op list — each row: `dim` · `fn ▾` · reorder handles · remove (×);
  the resulting grain and n shown per row.
- **+ add level** — re-include a removed dim.
- **Test reads at: [node ▾]** — the plan's nodes, each with its n.
- Live guard text inline (mirrors the graph badges).
- **Reset to default** — regenerate the plan from the table-level spine (it is a
  *removable* default).

New analyses seed their plan from the table-level spine. The table-level
**HierarchyPanel stays** (roles, default spine order, default `fn`).

### `src/explorer/graph.ts`

`buildGraph` consumes the `CollapsePlan` instead of `hierarchy.spine` for the
collapse edges/nodes: one node per plan prefix (grain id from kept dims, label
derived from kept dims — "per experiment", "mean trajectory (experiment, frame)"),
one `collapse` edge per op. Node grains may be non-prefix subsets. Edges carry an
optional `guards: GuardVerdict[]` the renderer maps to badges. Pure, fully
unit-tested (extend `graph.test.ts`).

### `src/components/TransformExplorer.tsx`

Render the plan's nodes/edges as today, plus the white info badge on every
collapse edge and the yellow caution badges on the test/merging edges; the
aggregate caution dot on the `stats` node. The graph stays the **read-only live
visualization**; editing is the routing panel (edge-click editing is
sub-project 2, which will bind to these atoms).

### State

A per-analysis `collapse` plan + `testGrain` on the plottable (atoms in
`state.ts`), seeded from the table-level hierarchy, edited by the routing panel,
consumed by `graph.ts`/`buildGraph` and the `/reduce`·`/shape_counts` calls.

## Persistence (`.iris`)

Record the analysis **as-is**: the full `collapse` plan and `testGrain` go on the
analysis spec (`buildSpec` already embeds `hierarchy` per-analysis). **No
deviation-diffing.** On load, an **absent** plan/grain regenerates the default
from the spine — not a back-compat concession but the identical path a *new*
analysis and a *CellFlow-exported* `.iris` (which never authors a plan) already
take. The format is ours to move (no users, no legacy); graceful default-on-
absent is the only load-time rule.

## Testing

- **Engine:** `materialize_levels` under non-default plans — skip-a-level, the
  keep-finer mean-trajectory grain `(experiment, frame)`, reordered ops; the
  three guard helpers including the **coordinate exemption** for #4; and a
  **regression pin** that the default plan reproduces today's exact per-level
  output (rows, cols, values).
- **Frontend:** `graph.test.ts` — nodes/edges (incl. non-prefix grains) and badge
  mapping from a plan; routing-panel atoms; seed-from-default; reset-to-default.
- **e2e (Playwright):** edit the plan → the graph re-routes; retarget the test to
  a finer node → a yellow badge appears on the test edge; the white info badge is
  always present on collapse edges.
- `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `pytest` all green.

## Out of scope (later)

- **Branching (B):** multiple collapse paths from one node; the plot-
  disambiguation channel a same-grain branch needs. Representable now, not built.
- **Edge-click editing (sub-project 2):** gestures on the graph; will drive the
  atoms defined here.
- **Aggregation-soundness judgments beyond identity-merge:** Iris does not claim
  to know whether a skipped level carries a real batch effect — that is domain
  knowledge. The white #3 info makes the consequence legible; it is not a warning.
