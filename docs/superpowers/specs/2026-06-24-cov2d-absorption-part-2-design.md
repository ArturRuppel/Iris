# COV2D Absorption — Part 2 Design (§3 / §4 / §5 figure assembly)

> Successor to `2026-06-24-cov2d-absorption-tier-b-c-design.md`. Part 1 landed the
> individual reduce *nodes* (derive bool/concat, pivot, grid_complete, expression
> filter) with unit tests, and the un-forced-nesting collapse machinery
> (`CollapsePlan` / arbitrary-grain materialize / pseudoreplication·pairing·identity
> guards). Part 2 is the deferred half: **composing those nodes into the actual
> §3/§4/§5 figures and proving each reproduces the notebook's numbers.** The gate
> ("resume when un-force-nesting lands") is now lifted — it's on `main`.

## What's already true on `main` (verified 2026-06-24)

- **Reduce vocabulary:** `drop`, `filter`, `derive` (incl. boolean comparison →
  0/1 and string concat / `str()` cast), `recode`, `join`, `pivot`,
  `grid_complete`, expression-valued `filter` bound (`quantile(...)`). All run via
  `reduce.apply_reduction` / `reduce_with_trace`.
- **Collapse plan:** `hierarchy.default_plan` / `materialize_plan` /
  `materialize_levels`. A plan is `list[{keep: [...spine dims], fn: "mean|median|sum|min|max"}]`;
  grains are keyed by kept dims joined with `/` (`""` = raw). Persisted on the
  analysis spec as `collapse` + `test_grain`; absent ⇒ regenerated from
  `hierarchy.spine`.
- **Guards:** `hierarchy.pseudoreplication` / `pairing_flip` / `identity_merge`,
  surfaced via `/shape_counts` → `guards` → `mergeGuards` → amber/white badges on
  explorer edges (`src/explorer/graphAtom.ts`, `TransformExplorer.tsx`).

## The central problem: ordering is strict `reduce → collapse → stat`

`render.py` (≈ lines 74–200) runs, in this fixed order:

1. `reduce.apply_reduction(df, schema, steps)` — **all** reduce steps, on the
   **raw** per-frame table.
2. `materialize_levels` / `materialize_plan` — collapse the reduced table to every
   grain.
3. select the test-grain table (explicit `test_grain` or derived coarsest).
4. `stats.*` — the inferential test consumes the **pre-materialized** grain table;
   no further aggregation or reduction happens.

**There is no way today to aggregate to a chosen grain and then run another
derive / join / pivot at that grain.** That capability — call it a *post-collapse
reduce phase* — is the architectural heart of Part 2, because two of the three
target sections need exactly it:

- **§3 enrichment** is `log2(Σobs / Σexp)` — a derive over **per-replicate sums**,
  i.e. a derive *after* a `sum`-collapse to `experiment` grain.
- **§4 crowding** joins four per-cell feature tables, pivots `opp → s,o`, and
  derives `het = o/(s+o)` — all *at per-cell grain*, i.e. after a `median`-collapse
  from per-frame to `experiment/position/cell`.

§5, by contrast, needs **no** collapse at all (see below) — it's the free win that
proves the equivalence harness before any engine change.

## Resolved fork: a post-collapse reduce phase, not a "join plan node"

Part 1 flagged an open fork — "join consuming a plan node." We resolve it
**against** weaving joins into the collapse plan, and **for** a second, explicitly
ordered reduce phase:

- **Decision:** add an optional `reduce.post` (alias: phase-2 steps) to the
  analysis spec — the **same step kinds**, run on the **selected test-grain table**
  after collapse, before the stat. Pre-collapse `reduce.steps` stay exactly as
  they are (raw-grain only).
- **Why not a plan node:** the collapse plan is a clean grain-list (`{keep, fn}`)
  whose only job is nested aggregation; threading joins/derives into it would
  overload that structure, break the median-of-medians invariant, and entangle two
  orthogonal concerns (what grain vs. what transformation). A second phase keeps
  each structure single-purpose and makes the grain-of-execution explicit and
  inspectable.
- **Spec shape:**
  ```json
  {
    "reduce":  { "steps": [ ... raw-grain steps ... ],
                 "post":  [ ... steps run on the test-grain table ... ] },
    "collapse": [ {"keep": [...], "fn": "sum|median|..."}, ... ],
    "test_grain": "experiment"            // or "experiment/position/cell"
  }
  ```
  Absent `reduce.post` ⇒ today's behaviour, byte-identical. The phase runs the
  existing `reduce.apply_reduction` on `stat_df` (the chosen grain) immediately
  before the stat call in `render.py`; no stat function changes.

## C3 — the post-aggregate-derive guard

A derive in `reduce.post` is a derive where grain-safety is no longer free (the
value is computed on already-aggregated rows). Model the guard on
`identity_merge` (the closest existing one — it inspects the plan and reports a
consequence of collapsing):

- **Compute:** `hierarchy.post_aggregate_derive(steps_post, plan, test_grain)` —
  emit one verdict per `derive` in `reduce.post`, severity `caution`:
  `{step_index, grain: test_grain, reason}`.
- **Surface:** add `post_aggregate_derive` to the `/shape_counts` `guards` dict,
  the `ShapeCountsGuards` TS interface, and `mergeGuards`; route each verdict to
  its post-phase derive edge (amber badge). Reuses the existing badge renderer.
- **Stance:** this is a *warning, not a wall* — §3's `log2(Σobs/Σexp)` and §4's
  `het` are legitimate post-aggregate derives. The guard educates; the user
  proceeds. (Iris guides; the user is responsible.)

## B1 / B3 — composition, no new engine code

- **B1 (N-way join):** §4's `per_cell_features` is a chain of landed `join`s, each
  an inner merge on `KEY = [experiment_id, position_id, cell_id]`, run in
  `reduce.post` at per-cell grain. No new step kind.
- **B3 (split-and-map recode):** §5's `_ttype` (contact_type → transition-type)
  ships as a **flat enumerated `recode`** over the finite contact-type vocabulary
  — the split-on-"→"/`_hh` logic is pre-computed into a `{contact_type: tt}` map
  at authoring time. Landed `recode`, no parser.

## Section-by-section assembly (the equivalence targets)

Each section's notebook prep, re-expressed in the new vocabulary, with the report
numbers it must reproduce.

### §5 — T1 transition rates **(no collapse; landed nodes only — the free win)**
Source: per-T1-event table (`signed_contact_length_labeled.csv`, one row per
event/role). Pipeline, all in `reduce.steps`:
1. `recode` `contact_type → tt` (flat enumerated, 4 levels in `_TT_ORDER`).
2. `derive` `ev = experiment_id +"|"+ position_id +"|"+ str(t1_event_id)`.
3. `grid_complete` `by=[experiment_id, position_id]`, `column=tt`,
   `levels=_TT_ORDER`, `count_unique="ev"`, `fill=0`, `count_name="count"` →
   per-(field × type) counts on a 0-filled 27×4 grid.
4. `derive` `hours = 12.5` (constant exposure; 50 frames × 15 min / 60).
5. **rate** family, grouped by `tt`, value `count`, offset `log(hours)`, NB model.

**Reference (must match):** rates events/h/field (95 % CI), n=27 fields —
homo→homo **4.04 [2.92, 5.60]**, hetero→hetero **3.08 [1.91, 4.96]**, homo→hetero
**3.56 [2.40, 5.29]**, hetero→homo **3.56 [2.36, 5.37]**; global NB-GLM LR
**p = 0.833**.

**§5 landscape:** the tail-clip `|signed_length| ≤ quantile(abs(signed_length),
0.99)` is the landed expression-valued `filter` (C5). Verifies the realized 99th-
pct bound is logged to the trace.

### §3 — neighbour enrichment **(sum-collapse + post-aggregate derive + location)**
Source: `neighbor_enrichment.csv` (per frame × focal cell × neighbour label).
1. `reduce.steps`: `derive opp/homo` flag (landed), `filter` to the homo (or het)
   lane.
2. `collapse` to `experiment` grain with **`fn: "sum"`** → Σobs, Σexp per replicate
   (n=3).
3. `reduce.post`: `derive enrich = log2(obs / exp)` — **the C3 post-aggregate
   derive** (fires the guard).
4. **location** family: one-sample t of `enrich` vs 0 (the notebook pools via
   geometric mean of the linear ratio = mean of log-ratio).

**Reference (must match):** homotypic ratio **1.05× (p = 0.0026)**, heterotypic
**0.93× (p = 0.054)** — i.e. the per-lane one-sample t on the log-ratios.

### §4A — crowding (Spearman) **(median-collapse + N-way join/pivot/derive + replicate correlation) — riskiest**
Source: four per-frame/per-event tables sharing `KEY`. Target `per_cell_features`:
`q = perimeter/√area`, `speed = speed_um_per_s × 3600`, `nbr = n_neighbors`,
`het = o/(s+o)`, `cls = class_label`.
1. `reduce.steps`: per-table `derive`s (`q`, `speed×3600`, `opp` flag).
2. `collapse` to `experiment/position/cell` grain, `fn: "median"`.
3. `reduce.post` at per-cell grain: the four `join`s (B1), the `pivot` `opp → s,o`
   (landed C2), `derive het = o/(s+o)` (C3 guard).
4. **correlation** family — **replicate-level Spearman**: per-`experiment` Spearman
   ρ, Fisher-z across n=3, one-sample t.

**Reference (must match):** shape q vs neighbour count **r = −0.174, p = 0.0492**;
speed vs neighbour count **r = −0.122, p = 0.0078**.

**Open sub-question (the risk):** does the landed `correlation` family support the
*replicate-level* design (per-group Spearman → Fisher-z → one-sample t), or does it
correlate pooled rows? If the former isn't expressible, §4A spawns a small
correlation-family extension (a nested/replicate correlation design) as its own
spec item — do **not** reimplement it ad hoc. This is the one item that may not be
pure composition; it is explicitly the last and riskiest task, and may be deferred
again if the stat extension proves large.

## Out of scope (Tier D — stays upstream, do NOT absorb)

§4B's velocity-correlation **functions** (`coordination.py`: `C_v(r)` / `S(r)`,
ξ_s, the shuffle null → a line plot) are outside Iris's per-replicate SuperPlot+test
model, exactly as in the original tier map. They produce the tidy table; they are
not reshaping of it.

## Acceptance

- **Iris repo (unit tests, fixtures):** the post-collapse reduce phase (`reduce.post`
  runs the right kinds on the test-grain table; absent ⇒ unchanged), and the C3
  guard (one verdict per post-phase derive, routed to its edge). Full engine +
  frontend suites stay green; `tsc` + Vite build clean.
- **COV2D data repo (dogfooding equivalence):** a script per section that builds
  the pipeline above against the **real** csvs and asserts it reproduces the quoted
  numbers to full precision (mirrors the Part-1 verification scripts), emitting a
  self-contained `.iris` per section. These are the actual proof of absorption; the
  real data lives in the data repo, not Iris, so they ride there.

## Sequencing rationale

§5 first (no engine change — proves the harness and the landed nodes on a real
section). Then the post-collapse phase (unblocks §3 + §4). Then §3 (simplest user
of the phase: scalar derive + location). Then the C3 guard. Then §4A last (N-way
join + pivot + the correlation-design risk). Frontend graph support for post-phase
edges rides alongside the engine phase.
