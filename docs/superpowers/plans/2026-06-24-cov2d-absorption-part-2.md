# COV2D Absorption — Part 2 Implementation Plan (§3 / §4 / §5 assembly)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Assemble the COV2D §3/§4/§5 figures inside Iris and prove each reproduces
the notebook's numbers, building the one missing engine capability (a post-collapse
reduce phase) plus its guard, and composing already-landed nodes for the rest.

**Spec:** `docs/superpowers/specs/2026-06-24-cov2d-absorption-part-2-design.md`

**Ground truth verified 2026-06-24:** pipeline ordering is strict
`reduce.steps → collapse → stat` (`render.py` ≈ 74–200); post-aggregate ops are
**not** expressible today. §5 needs no collapse; §3/§4 need the new phase.

**Acceptance:** new engine mechanics have fixture unit tests; full engine +
frontend suites stay green; `tsc` + Vite build clean; and a dogfooding script per
section reproduces the quoted numbers against the real COV2D data (in the data
repo), emitting a self-contained `.iris`.

---

## Phase 0 — §5 T1 rates + landscape (no engine change; the harness proof)

§5 is fully expressible on landed nodes (`recode`, `derive`, `grid_complete`,
expression `filter`, rate family). Build it first to validate the equivalence
harness before touching the engine.

**Files:** `electronic_labbook_database` (data repo) — a verification script under
`reports/COV2D/` (model on the Part-1 `verify_landed_steps.py` /
`convert_selfcontained.py`).

- [ ] **Step 1:** Author the §5 rate pipeline as reduce steps: `recode`
  `contact_type → tt` (flat enumerated map over the finite vocabulary, order
  `_TT_ORDER`); `derive ev`; `grid_complete by=[experiment_id, position_id],
  column=tt, levels=_TT_ORDER, count_unique="ev", fill=0, count_name="count"`;
  `derive hours = 12.5`; rate family grouped by `tt`, offset `log(hours)`, NB.
- [ ] **Step 2:** Run against the real `signed_contact_length_labeled.csv`; assert
  rates + 95 % CI per type and the global LR `p = 0.833` match `write_t1_rate_iris`
  (homo→homo 4.04 [2.92, 5.60], hetero→hetero 3.08 [1.91, 4.96], homo→hetero
  3.56 [2.40, 5.29], hetero→homo 3.56 [2.36, 5.37]).
- [ ] **Step 3:** §5 landscape — `filter` `abs(signed_length) <= quantile(abs(signed_length), 0.99)`;
  assert the kept set equals the notebook's symmetric clip and the realized 99th-pct
  bound is exposed in the trace.
- [ ] **Step 4:** Emit `reports/COV2D/selfcontained_preview/t1_rate.iris` (+ landscape);
  save→reload→render reproduces the numbers. Commit (data repo).

---

## Phase 1 — post-collapse reduce phase (the one engine capability)

Add `reduce.post`: the same step kinds, run on the selected test-grain table after
collapse, before the stat. Absent ⇒ byte-identical to today.

**Files:** `engine/iris_engine/render.py` (thread the phase), `engine/iris_engine/main.py`
(accept `reduce.post` on the relevant requests), tests
`engine/tests/test_reduce_post_phase.py`.

- [ ] **Step 1: Failing test** — a spec with `collapse` to a coarse grain + a
  `reduce.post` `derive` on an aggregated column; assert the stat sees the derived
  column and that a spec **without** `reduce.post` is unchanged (regression guard).
- [ ] **Step 2:** In `render.py`, after the test-grain table is selected (`stat_df`)
  and before the stat call, run `reduce.apply_reduction(stat_df, stat_schema,
  spec["reduce"].get("post") or [])`. Reuse the existing reducer verbatim; do not
  touch stat functions. Mirror the change in any `/analyze` / `/reduce` path that
  must preview the post-phase grain.
- [ ] **Step 3:** Run → PASS; full engine suite green (the absent-`post` path proves
  no regression).
- [ ] **Step 4: Commit** `feat(render): post-collapse reduce phase (reduce.post)`.

---

## Phase 2 — §3 neighbour enrichment (first real user of the phase)

Simplest consumer: a scalar post-aggregate derive feeding a one-sample location
test.

**Files:** data repo verification script `reports/COV2D/`.

- [ ] **Step 1:** Pipeline: `reduce.steps` derive the homo/het flag + `filter` the
  lane; `collapse` to `experiment` grain with **`fn: "sum"`** (Σobs, Σexp per
  replicate); `reduce.post` `derive enrich = log2(obs/exp)`; location family,
  one-sample t of `enrich` vs 0.
- [ ] **Step 2:** Run against `neighbor_enrichment.csv`; assert per-lane t matches
  `clustering_stats` / `write_neighbor_enrichment_iris` — homo **1.05× p = 0.0026**,
  het **0.93× p = 0.054**.
- [ ] **Step 3:** Emit `reports/COV2D/selfcontained_preview/neighbor_enrichment.iris`;
  round-trip reproduces. Commit (data repo).

---

## Phase 3 — C3 post-aggregate-derive guard

Warn (not block) on a `derive` in `reduce.post`. Model on `identity_merge`.

**Files:** `engine/iris_engine/hierarchy.py` (compute) + `main.py` (`/shape_counts`),
`src/types.ts` (`ShapeCountsGuards` + verdict), `src/explorer/graphAtom.ts`
(`mergeGuards`), test `engine/tests/test_guard_post_aggregate.py` + a `graphAtom`
test.

- [ ] **Step 1: Failing test** — `post_aggregate_derive(post_steps, plan, test_grain)`
  returns one `caution` verdict per post-phase `derive` (`{step_index, grain,
  reason}`), `[]` when `reduce.post` has no derive.
- [ ] **Step 2:** Implement the compute fn; wire it into the `/shape_counts` `guards`
  dict; extend `ShapeCountsGuards` + `mergeGuards` to route each verdict to its
  post-phase derive edge with an amber badge (reuse the renderer).
- [ ] **Step 3:** Engine + frontend tests green; `tsc` clean.
- [ ] **Step 4: Commit** `feat(guards): post-aggregate-derive caution on reduce.post`.

---

## Phase 4 — §4A crowding (riskiest; N-way join + pivot + replicate correlation)

**Files:** data repo verification script; **possibly** a correlation-family engine
extension (its own spec if non-trivial — see the open sub-question).

- [ ] **Step 1:** `reduce.steps` per-table derives (`q`, `speed×3600`, `opp`);
  `collapse` to `experiment/position/cell` with `fn: "median"`; `reduce.post`: the
  four inner `join`s (B1), `pivot opp → s,o` (C2), `derive het = o/(s+o)` (C3).
- [ ] **Step 2: Decision gate — replicate correlation.** Check whether the landed
  `correlation` family expresses *per-`experiment` Spearman → Fisher-z → one-sample
  t*. If yes: author it and assert q-vs-nbr **r = −0.174 p = 0.0492**, speed-vs-nbr
  **r = −0.122 p = 0.0078** against `replicate_spearman`. If no: **stop**, write a
  short `correlation`-family extension spec (replicate/nested design), and defer §4A
  to that — do NOT hand-roll the stat.
- [ ] **Step 3:** On success, emit `reports/COV2D/selfcontained_preview/crowding.iris`;
  round-trip reproduces. Commit (data repo).

---

## Phase 5 — Frontend: post-phase edges in the explorer graph

**Files:** `src/explorer/graph.ts` (+ `graph.test.ts`), `src/types.ts`.

- [ ] **Step 1:** `buildGraph` renders `reduce.post` steps as linear edges *after*
  the collapse chain (between the collapse output and the stat node), distinct from
  pre-collapse `reduce.steps`. Add a `graph.test.ts` case (post-phase derive carries
  the C3 amber badge).
- [ ] **Step 2:** `tsc` + Vite build + `npm test -- graph` green.
- [ ] **Step 3: Commit** `feat(explorer): render post-collapse reduce phase edges`.

---

## TODO hook

When Phase 4 resolves (or §4A is deferred to a correlation-family spec), update the
COV2D **Status** block in `TODO.md` — the "Deferred part 2" list shrinks to whatever
remains (most likely just the replicate-correlation stat extension).

## Execution Handoff

Phases are mostly sequential by dependency (1 unblocks 2 & 4; 3 rides on 1). Phase 0
is independent and should go first. Phase 4 has a hard decision gate that may spawn a
follow-up spec rather than completing here.
