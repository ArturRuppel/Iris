# Workbench feature — refactor & simplification audit

_Date: 2026-06-28. Scope: the multi-table + Workbench/transformation-explorer feature
(~6,200 lines changed over the last ~20 commits). Audited clusters: `src/state.ts` +
`src/types.ts`, `src/workbench/`, `src/explorer/`, and the engine multi-table changes in
`engine/iris_engine/document.py` / `importer.py` / `main.py`._

## Verdict

Healthier than feared. All four cluster audits independently concluded the feature is
well-decomposed: pure logic is separated from rendering, the workbench does **not** keep a
second stored copy of the graph (it derives react-flow nodes on the fly), and the
engine/frontend seam is clean and explicit. No five-alarm fire. But there is real,
concentrated debt, and three cross-cutting themes explain most of it — plus two genuine
latent bugs.

Convention used below: **Severity** HIGH / MEDIUM / LOW · **Effort** S / M / L.

---

## Three root causes (each appears in multiple places)

### Theme 1 — Structurally-known facts are thrown away, then reverse-engineered

The biggest entanglement smell. A fact that is known statically at the producer gets
dropped, then re-derived downstream from id-strings or async data.

- **Spine discarded and re-guessed.** `buildGraph` receives the authoritative `spine`
  (nesting order from `hierarchyAtom`), uses it (`src/explorer/graph.ts:169,211-223`), but
  never records it on the returned `ExplorerGraph`. The workbench then re-derives it
  heuristically in `nodeDelta.spineOf` (`src/workbench/nodeDelta.ts:29-36`) as "node with
  the most `count.axes`". That guess depends on async `/shape_counts`, so **the grain
  bar/legend have no spine until counts load.** _(explorer #2 · HIGH · M)_
- **Node identity smuggled through id-string prefixes.** `grain:` / `source:` / `step:i` /
  `post:i` are parsed by `startsWith`/regex in 6+ files —
  `src/explorer/graphAtom.ts:41-42`, `src/workbench/layout.ts:52`,
  `src/workbench/nodeDelta.ts:49`, `src/workbench/authoring.ts:40-43,74-77`,
  `src/workbench/ArrayShapeRFNode.tsx:22-23,37`, `src/workbench/cards/OpEditorCard.tsx:26`
  (and the dead `workspace.ts`) — even though `ExplorerNode` already carries a structured
  `kind`. Change an id format and five files break silently. _(explorer #3, workbench #2 ·
  HIGH/MEDIUM · M)_
- **Grain dims stored twice.** `graphAtom.dimsForNode` parses dims from the `grain:E/P` id
  string (`src/explorer/graphAtom.ts:40-46`); `nodeDelta` reads the same dims from
  `count.axes` (async). Two sources for one fact; before counts arrive `nodeDelta` sees
  nothing. _(explorer #4 · MEDIUM · M)_

**Fix (one move):** have `buildGraph` stamp `phase`, `dims`, and `spine` onto the
graph/nodes once, and `stepIndex` onto edges. Every consumer reads the field instead of
parsing id strings or guessing from async counts. Keep ids as opaque keys. This collapses
scattered parsing across ~6 files **and** removes the async-timing dependency that leaves
the grain bar blank. **This is the single highest-leverage refactor.**

### Theme 2 — Backward-compat code for formats nothing uses

"No legacy, no users" makes most of this deletable dead weight. **Exception:** the engine
2.0 reader (see below) is currently load-bearing for the shipped example gallery and must be
retired in sequence, not deleted outright.

> **Correction (verified 2026-06-28 during step-1 execution):** the _frontend_ migrations
> are also entangled with the stale gallery, not safe pure deletions. Empirical check: all 24
> shipped examples are `format_version: 2.0` with `spec_version: 2.1` analyses, and at least
> one example carries non-empty layer `params`. `migrateLayerParams` (`src/state.ts:571`)
> hoists params from **all** layers unconditionally on every load (`state.ts:606-607`), so it
> actively transforms current example data. Therefore `migrateDistLayers`,
> `migrateLayerParams`, `Layer.params`, the retired `histogram`/`density` `Geom` arms, and the
> flat legacy `StyleOverrides` keys move into the **sequenced** retirement alongside the engine
> 2.0 reader (regenerate the gallery to 2.1 + confirm the live engine specnorm no longer emits
> layer params → then delete). The `migrateSpec` legacy branch and the 2.0 inline-join loop in
> `loadDocumentAtom` are dead against current data but are grouped with the same sequenced step
> to keep the cut atomic. None of these were deleted in step 1.

- **Frontend migrations (delete):** `migrateDistLayers` (`src/state.ts:547-565`),
  `migrateLayerParams` (`src/state.ts:571-597`), and the **entire 2.0 inline-join migration
  loop** in `loadDocumentAtom` (`src/state.ts:704-758`, ~half the 100-line atom); the legacy
  branch of `migrateSpec` in `src/types.ts:531-569` (keep the function as an identity cast —
  still called in `App.tsx:443,465` — but delete the body; `MODERN_SPEC_VERSIONS` already
  short-circuits every real file). _(state H2 · HIGH · M)_
- **Dead types/constants (delete):** `Mark` (`src/types.ts:71-73`, zero refs), `EMPTY_REDUCE`
  (`src/types.ts:284`), the retired `histogram`/`density` geom arms (`src/types.ts:81`) and
  `Layer.params` (`src/types.ts:93`), the flat legacy `StyleOverrides` keys
  (`src/types.ts:364-376`). All verified zero-reference or migration-only. _(state M2 ·
  MEDIUM · S)_
- **Cast-driven optional fields** that exist only because two serialization formats coexist
  (`src/state.ts:613,629-631,643`; optional `table_id`/`right`/`right_table_id` in
  `src/types.ts:254,434`) — after the migrations are deleted, make these required and drop
  the `as {…}` casts. _(state M3 · MEDIUM · S, gated on H2)_

### Theme 3 — Boilerplate fan-out (parallel maps, near-identical files)

Low-risk, high-tidiness wins.

- **Five card components are 13-line wrappers that ignore their props** —
  `src/workbench/cards/{PlotCard,StatsCard,CollapseCard,TestCard,GeomCard}.tsx`. A lookup
  table expressed as 5 files + 5 test files. Fold into data-driven `cardRegistry` entries
  (`{className, testid, render}`); keep only the prop-reading cards (`TableCard`,
  `OpEditorCard`, `AnnotateCard`) as real components. _(workbench #1 · HIGH · S)_
- **Seven enum-keyed record literals scattered across three files** (`edgeMeta.ts`,
  `cardRegistry.tsx`, `authoring.ts`). `CARD_BODIES`+`CARD_TITLE` should be one
  `Record<CardKind, {title, body}>`; `REDUCE_LABEL`+`REDUCE_ORDER` duplicate the reduce
  vocab (a third copy mirrors `TableCard`'s `KIND_LABEL`). _(workbench #5 · MEDIUM · M)_
- **~12 plottable/layer writer atoms repeat `get/guard/set` boilerplate**
  (`src/state.ts:970-1009,1038-1163`); `moveStepAtom`/`moveLayerAtom`/`moveSpineAtom` have
  byte-identical reorder logic. Add `updateActive(get,set,fn)` and `reorder(arr,i,dir)` and
  route all writers through them. _(state H4 · HIGH · S)_

---

## Two genuine bugs (not tidiness)

- **`doc_load` creates one session per table, but `SessionStore` is a bounded LRU of 8.** A
  document with >8 tables silently evicts the earliest tables **before the load response is
  returned**, handing the frontend session ids that are already dead — silent data loss.
  `engine/iris_engine/main.py:760-767` vs `session.py:84` (`maxlen=8`). Fix: size the store
  to the document's table count on load, load lazily, or fail loudly. _(engine #6 · MEDIUM ·
  S–M)_
- **`src/explorer/workspace.ts` (100 lines) + `workspace.test.ts` are entirely dead** — a
  second, unused graph→view adapter that duplicates `nodeDelta`/`layout`/`variantOf` logic.
  Imported only by its own test. Pure deletion. _(explorer #1 · HIGH · S)_

---

## The engine 2.0 reader — retire in sequence, do NOT delete first

Unlike the frontend, the engine's legacy 2.0 `.iris` reader (`document.py:91-113`) is
**currently exercised by real shipped data**: every bundled `.iris` in
`src/examples/assets/*.iris` and `dist/assets/*.iris` is `format_version: "2.0"`. Those are
the files users open from the examples gallery.

But it is a stale-artifact situation, not a permanent compat contract: the build pipeline
(`engine/validation/harness.py:88-106` → `save_document`) already emits **2.1**; the on-disk
examples simply predate the 2.1 commit. Correct sequence:

1. Regenerate the example corpus to 2.1 (`engine/validation/build.py` over all cases),
   including the `dist/assets` copy.
2. Verify no `format_version: "2.0"` remains.
3. **Then** delete `document.py:107-113`, drop the `else` branch, collapse the version gate,
   and remove `_legacy_2_0_bytes` + `test_load_migrates_legacy_2_0_single_table` (that test
   fabricates its own 2.0 bytes, so it proves nothing about real compatibility).

_(engine #1 · HIGH · M)_

---

## Smaller items worth noting

### Frontend state / types
- **`src/state.ts` is a 1163-line god-module** mixing ~15 concerns (view atoms, style
  clipboard, LRU analysis cache, document load/save + migration, spec builders, plottable
  CRUD, layer CRUD, hierarchy atoms) — interleaved, not grouped. Split into `cache.ts`,
  `spec.ts`, `document.ts`, `crud.ts`. Mechanical. _(state H1 · HIGH · M)_
- **Two parallel atom families** — `schemaAtom`/`hierarchyAtom`/`tableHandleAtom`
  (`src/state.ts:21-56`, "analysis pool table") vs `activeSchemaAtom`/etc.
  (`src/state.ts:340-342`, "active Data-tab table"). An admitted shim; consumers must know
  which to read. Rename for intent (`analysisSchemaAtom` vs `tableSchemaAtom`). _(state H3 ·
  HIGH · M)_
- **Duplicated cache-reset / cache-writer logic** — `resetAnalysisCaches(set)` and
  `dropAnalysis(get,set,id)` should be extracted (copy-pasted at `src/state.ts:537-540`,
  `692-695`, `936-942`); two overlapping cache writers (`setAnalysisResultAtom`,
  `setAnalysisByIdAtom`). _(state M1 · MEDIUM · S)_
- `specForSave` carries a dead `cache` param; family-derivation block duplicated between
  `specAtom` and `buildAllSpecs`. _(state M4 · MEDIUM · S)_
- `StatsResult.result` is a ~20-field all-optional grab-bag with `reference` declared three
  times; a discriminated union on `result.test` would document co-occurrence. _(state M5 ·
  MEDIUM · M)_

### Workbench
- **Node classification convention duplicated across 4 files** — `variantOf`, `accentKind`,
  `eyebrowText`, `isSource`, `phaseOf`, plus inline `startsWith` — collapse into one
  `classifyNode`/`phaseOf` + a phase→presentation table. (Same root as Theme 1.) _(workbench
  #2 · HIGH · M)_
- **Dead drag-to-join path:** `authoring.isValidDropTarget` (`src/workbench/authoring.ts:66-70`)
  and the "drag source for join" comments in `ArrayShapeRFNode.tsx:81,95` — no `onConnect`/
  `onDrop` exists. Delete. _(workbench #3 · MEDIUM · S)_
- **Rename `layoutResize.ts` → `paneTiling.ts`.** It's pure pane-tiling geometry, unrelated
  to `layout.ts`'s DAG rank/row placement; the shared name falsely implies they should
  merge (they share no logic). _(workbench #4 · MEDIUM · S)_
- **`WorkbenchCanvas` syncs props→react-flow-state in three places** (`:89` useMemo, `:130-151`
  effect with disabled exhaustive-deps, `:154-159` tidy). Extract a `useGraphToReactFlow`
  hook to contain the one genuinely subtle sync. _(workbench #6 · MEDIUM · M)_
- Edge-routing geometry (`WorkbenchEdge.tsx:18-62`) is correct and tested — just over-
  commented (three overlapping rationale blocks). Collapse the prose. _(workbench #7 · LOW ·
  S)_

### Explorer
- `buildGraph` computes the test label twice (`src/explorer/graph.ts:235-236,281-283`).
  _(explorer #5 · LOW · S)_
- `void get(effectiveTestGrainAtom)` (`src/explorer/graphAtom.ts:117`) is a manual
  dep-tracking hack via a side-effecting read; make the dependency explicit. _(explorer #6 ·
  LOW · S)_
- `cannedExamples.ts` is **not** dead (live in `ArrayShapeRFNode.tsx:60`) — leave it.
  _(explorer #7)_

### Engine
- Three copies of the slow `json.loads(df.to_json(orient="records"))` row-extraction idiom
  (`document.py:105,113,194`) bypass the canonical `session.records()` helper — and
  `doc_save` (`main.py:743`) sniffs `"rows" in t else …frame`. Add one shared `rows()`
  accessor. _(engine #3,#5 · MEDIUM · S)_
- The `{name: {schema, hierarchy, rows}}` table-pool dict is hand-munged across 5 sites with
  ad-hoc `.get("hierarchy", {…})` defaults — candidate for a small `@dataclass Table`.
  _(engine #4 · MEDIUM · M)_
- Table name is used as an unsanitized ZIP path segment (`document.py:55-59,96`) — a name
  with `/` or `..` corrupts the archive. Validate/slug, or use index dirs. _(engine #7 ·
  LOW · S)_
- Comments claim the store is "de-duplicated" but there is no dedup code — uniqueness is
  just the dict key. Reword to avoid sending a future reader hunting. _(engine #8 · LOW · S)_

---

## Recommended sequence (risk-ascending, each independently shippable)

1. **Pure deletions** (afternoon, near-zero risk). ✅ **DONE 2026-06-28** — deleted
   `src/explorer/workspace.ts` (+test), the `Mark` type, `EMPTY_REDUCE`,
   `authoring.isValidDropTarget` (+tests), and the dead drag-to-join comment. tsc clean, 332
   tests green. **Deferred** the migration-related deletions (`migrateDistLayers`,
   `migrateLayerParams`, `Layer.params`, retired geoms, flat style keys, `migrateSpec` legacy
   branch, 2.0 inline-join loop) to step 4 — see the Theme-2 correction above; they are
   load-bearing for the stale 2.0 example gallery.
2. **The structural-discriminant refactor** (Theme 1). ✅ **DONE 2026-06-28** — stamped
   `ExplorerNode.phase`/`dims`/`stepIndex` and `ExplorerGraph.spine` at `buildGraph`; deleted
   `nodeDelta.spineOf`, `graphAtom.dimsForNode`, `authoring.stepIndexOf`, and the
   `startsWith`/regex id-parsing across `ArrayShapeRFNode`/`authoring`/`layout`/`nodeDelta`/
   `OpEditorCard`. `mergeGuards`/`authorDispatch` take the discriminant; grain legend renders
   synchronously (blank-grain-bar timing bug fixed). tsc + build clean, 330 tests pass.
3. **Boilerplate consolidation** (Theme 3). ✅ **DONE 2026-06-28** — (a) deleted the 5 static
   card components + their tests, replaced by a `staticBody` factory in `cardRegistry`; merged
   `CARD_BODIES`+`CARD_TITLE` into one `CARD` map (the 5 deleted tests' kind→leaf wiring,
   incl. the stats-vs-test anti-swap check, folded into `cardRegistry.test`). (b) Hoisted the
   reduce vocabulary to one source `REDUCE_KIND_LABEL`/`REDUCE_KIND_ORDER` in `types.ts`,
   consumed by `authoring` and `PipelineSection` (the third copy removed). (c) Added
   `updateActive`/`reorder` in `state.ts` and routed the ~12 step/layer/spine writers through
   them (`patchActive` now wraps `updateActive`). tsc + build clean, 328 tests pass; net
   −163 lines.
4. **The two bugs**: (a) ✅ **DONE 2026-06-28** — the `SessionStore`-8 silent eviction:
   `SessionStore.ensure_capacity(n)` raises the LRU bound to fit a loaded document's table
   cohort; `doc_load` reserves it before the create burst. Unit + end-to-end (10-table
   roundtrip) regression tests; 515 engine tests pass. The save-side >8 cap (would 409) is a
   separate documented limitation (rehydrate-from-rows) and remains. (b) ⏳ **PENDING** —
   regenerate the 2.0 example gallery to 2.1 → confirm no `format_version: 2.0` remains →
   delete the engine 2.0 reader → then the deferred frontend migration deletions (Theme 2).
5. **Optional**: split `state.ts` into modules; rename `layoutResize.ts`; the `StatsResult`
   union.
