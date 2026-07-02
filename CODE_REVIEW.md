# Iris — Code Review

*Date: 2026-07-01. Scope: full repository (`src/` TypeScript frontend, `engine/` Python engine, `src-tauri/` shell, build/config). Focus: bugs — especially numerical/scientific mistakes — dead code, and simplification potential.*

**Baseline:** all suites pass — 362 frontend tests, 491 engine tests, 29 validation cases. The statistics core (`stats.py`) is careful and well-documented. The findings below are ordered by severity; the top items were reproduced by execution, the rest verified by reading callers.

---

## 1. High severity — scientific / data integrity

### 1.1 CSV import silently corrupts US-formatted numbers in non-comma-delimited files — ✅ FIXED (2026-07-02)
`engine/iris_engine/importer.py:46-56` (`_sniff`) and `:159-163` (`_as_numeric`) — **reproduced by execution.**

> **Resolved:** `_sniff`'s substring test replaced by content-aware `_infer_decimal`/`_classify_decimal` — only wholly numeric cells vote, both-separator tokens use rightmost-wins, lone 3-digit groups abstain. A stray `3,4` in free text no longer flips the decimal; ambiguous thousands cells surface as *unparsed* rather than silently wrong. Regression tests added; full engine suite green. Remaining gap (out of scope): genuine US thousands separators still don't auto-parse — better than corruption, but unhandled.

`_sniff` infers `decimal=","` whenever the delimiter isn't `,` and the pattern `\d,\d` appears anywhere in the first 64 kB — including thousands separators or digits in free text. `_as_numeric` then strips every `.` as a thousands separator and treats `,` as the decimal point. A tab-delimited file containing `1,234.56` imports as **1.23456** (1000× off) and `999.5` as **9995.0** (10× off), typed `numeric`, with zero unparsed-cell warnings — it passes the 95%-parse sanity check.

Reproduction:

```
sniff: {'delimiter': '\t', 'decimal': ','}
input:  1,234.56   999.5   2,000.75
output: 1.23456    9995.0  2.00075
```

**Fix:** only infer `decimal=","` when comma-decimals are consistent with column contents (no cell mixes `.` and `,`; or numeric-looking cells match `^\d+(\.\d{3})*(,\d+)?$` for the comma-decimal hypothesis), and surface the inferred choice prominently in the import preview.

### 1.2 Quantile filter bound drops every row when the column has a single NaN — ✅ FIXED (2026-07-02)
`engine/iris_engine/reduce.py:79` (`_eval_bound`) — **reproduced by execution.**

> **Resolved:** the quantile branch now uses `np.nanpercentile` (raising `ReduceError` when the column is wholly non-finite), and `_eval_bound_scalar` rejects any bound that realizes to a non-finite value as a backstop for NaN-producing arithmetic. Regression tests added (`test_quantile_bound_ignores_nans`, `test_quantile_bound_all_missing_raises`); full engine suite green (524 passed).

The expression-filter quantile uses `np.percentile`, not `np.nanpercentile`. With one NaN in the column, `quantile(v, 0.99)` evaluates to NaN, `v <= NaN` is uniformly False, and the filter silently keeps **0 rows**:

```python
df = pd.DataFrame({"v": [1.0, 2.0, 3.0, np.nan, 5.0]})
_apply_filter(df, schema, [{"column": "v", "op": "<=", "bound": "quantile(v, 0.99)"}])
# rows kept: 0, realized bound: [nan]
```

This is the documented §5 tail-clip use case applied to a measurement column, where NaNs are routine.

**Fix:** `np.nanpercentile`, plus a guard that raises `ReduceError` when a realized bound is NaN.

### 1.3 Changing a column's role in the Data tab never reaches the engine — stale schema drives the statistics — ✅ FIXED (2026-07-02)
`src/state.ts:1041-1069` (`setColumnRoleAtom`) — verified in code.

> **Resolved:** added a schema-patch endpoint (`POST /table/{id}/schema` → `SessionTable.set_schema`, data untouched, `version` bumped). `setColumnRoleAtom` now pushes the retyped schema to the engine session and folds the engine's bumped version onto the handle, so the analyze cache invalidates and the next render re-infers against the new types. The stale "re-uploads the table" comment is gone. Regression tests added at three levels — `set_schema` unit + inference-drift (`test_session.py`), the `/analyze`→patch→`/analyze` round trip (`test_engine.py`), and the atom's engine call + version propagation (`state.test.ts`). Full suites green (529 engine, 362 frontend). Aside: the drift surfaces as a hard 422 for a mapped-but-mistyped X, not a silent wrong test — same root cause, more visible face.

The comment claims "a schema change re-uploads the table, so the engine sees the new types" — false. `engine.createSession` is called only on import (`state.ts:583`), and `/analyze` sends only the session token (`App.tsx:174`), which the engine resolves to the schema captured at session creation (`main.py:296`). Re-typing `condition` from identifier to classifier and mapping it to X: the frontend derives `group_comparison`, but the engine's `statmodel.infer` (`statmodel.py:14,64,133-156`) still sees `identifier`, matches no branch, and silently returns the descriptive/no-test model. Frontend and engine can disagree about which test ran. E2E tests seed roles at import time, so the path is untested.

**Fix:** re-create the session (or add a schema-patch endpoint) on role change.

### 1.4 Pipeline-cache hits skip `guards.evaluate` — same spec renders differently (or 500s) depending on cache state — ✅ FIXED (2026-07-02)
`engine/iris_engine/main.py:440-445` — verified in code; **reproduced by execution.**

> **Resolved:** the pipeline-cache hit path in `_run` now calls `guards.drop_unrenderable_channels(schema, spec)` (using the cached reduced schema) before `build_figure`, re-applying the exact spec mutation the miss path performs inside `render()`. The drop is deterministic in `(schema, encodings)`, both of which are part of the cache key (only `style`/`stat_model`/`engine_snapshot` are stripped), so the hit path now produces byte-identical channel handling to the miss path. Reproduction (`size` mapped to a categorical column, then a font-only re-render) went from miss=200+warning / hit=**500** to both 200 + `channel_unrenderable`. Regression test added (`test_pipeline_cache_hit_still_drops_unrenderable_channels`); full engine suite green (501 passed).

The cache key strips only `style`, but guards mutate the spec in place (`drop_unrenderable_channels`, `guards.py:49-67`). Miss path: `size` mapped to a categorical column → 200 + `channel_unrenderable` warning. Hit path (identical spec, only `font_pt` changed): the un-dropped channel reaches the compiler → **500** (`to_numpy(dtype=float)` on strings, `scales.py:179`). For `shape`=numeric the failure is silent instead: the hit path draws per-value markers the miss path suppressed — two different figures from one spec. Reachable via a saved spec or a column retyped after mapping — the exact scenarios the guard denylist exists for (`guards.py:26-28`).

**Fix:** run the spec-mutating guards before the cache lookup, or store the mutated spec in the cached payload.

### 1.5 The ungrouped one-sample ("location") analysis can never render — ✅ FIXED (2026-07-02)
`engine/iris_engine/render.py:135-137` — **reproduced by execution.**

> **Resolved:** the fix runs deeper than the schema guard. (1) `render.py` now lets `cat_col=None` through the group-family branch for `family == "location"` (a named-but-missing column is still an error), and guards the later `levels = cat_schema.get(...)` against a `None` schema. (2) The compiler assumed a grouping column throughout: `_cat_levels` now returns a single synthetic `["all"]` lane when `cat_col is None`, `_groups` matches every row for that lane, and the `show_n` path counts it as one `"all"` group. (3) `stats.describe_groups` mirrored `stats.location`'s missing `x=None` branch, so the describe-only sub-path (e.g. a faceted ungrouped location) no longer `KeyError`s on `df[[None, y]]`. Reproduction (only Y mapped + `reference=70`) went from **422** ("grouping column None not found") to a 200 that draws one lane, runs the one-sample test, and returns an SVG. Regression tests added (`test_ungrouped_location_renders`, `test_ungrouped_location_describe_only_renders`); full engine suite green (503 passed).

`stats.location` (`stats.py:565`, `x: str | None`) and `statmodel.infer` (`statmodel.py:88-89`) both support a location test with no grouping column, and the frontend offers it (`channels.ts:97-108`: descriptive mapping + reference ⇒ `location`). But the shared group-family branch does `cat_schema = next(...)` on `cat_col=None` and raises `RenderError("grouping column None not found in schema")`. Every only-Y-plus-reference spec 422s. No test covers the ungrouped case.

**Fix:** allow `cat_col=None` through the location path; add a test.

---

## 2. Medium severity

- **Duplicate "from" keys destroy mapping rows in Recode/Pivot editors** — ✅ FIXED (2026-07-02). `RecodeStep.map` / `PivotStep.names` are now ordered `[from, to]` arrays instead of dicts, so two empty rows coexist and a `from` typed through a colliding value no longer merges/destroys a row. The engine coerces the array to a dict at the reduce boundary (`reduce._to_mapping`: drops empty-`from` rows, later-pair-wins) and still accepts the old dict form, so validation cases/older `.iris` files keep working; `plottableFromSpec` normalizes a loaded dict back to an array. Regression tests added on both sides (editor `b2`/`b3`/pivot `f`; engine pairs-array recode/pivot). The two editors are still verbatim copies — extracting one array-based editor remains open under §6. Full suites green (506 engine, 365 frontend).
- **`pruneIdentityGrains` compares against the wrong baseline** — ✅ FIXED (2026-07-02). Each `regroup` grain is now compared to its collapse predecessor (`counts[inEdge.fromId]`) instead of the source, so identity is the local property it always should have been. Fixes both directions: a filter upstream no longer leaves the leading full-spine grain falsely kept (its count now matches the filtered input), and a `grid_complete` that happens to restore the source count is no longer falsely pruned (its count differs from its densified predecessor). Regression tests added for both cases (`graphAtom.test.ts`); frontend suite green (367). Frontend-only change.
- **Import failure is invisible** — ✅ FIXED (2026-07-02). The dialog now opens on `preview || error` (not `file && (preview || error)`), so a first-ever pick that throws before `file` is set surfaces its error instead of leaving "Import data…" looking inert; the title guards the null file (`file?.name ?? "data"`). Regression test added (`ImportWizard.test.tsx`, mocks a rejecting `importUpload`); frontend suite green (368). Frontend-only change.
- **Duplicating a plottable orphans per-layer styles** — ✅ FIXED (2026-07-02): the duplicate re-keys `style.layers` to the fresh layer ids (regression test in `state.test.ts`). Original finding: `src/state.ts:887-901`. Layers get fresh `nextLayerId()`s while `style` is cloned verbatim, so `StyleOverrides.layers` (keyed by layer id — `types.ts:361-365`) stays keyed by the old ids. The duplicate loses all per-layer styling. `LayerStrip.tsx:26-29` preserves ids for exactly this reason.
- **Late-resolving `/analyze` overwrites the active plot's status** — ✅ FIXED (2026-07-02): both effects flip a `stale` flag in their cleanup; a superseded run still stores its id-routed result but no longer writes the global status/error. Original finding: `src/App.tsx:172-193`. Result routing is id-guarded but `setStatus`/`setRenderError` are not: switch plottables mid-render and the old request's failure shows as the new plot's "Render failed". Same pattern at `App.tsx:217-224` writes the global `engineErrorAtom` from a stale reduce-preview.
- **Unlocked caches mutated from uvicorn's threadpool** — ✅ FIXED (2026-07-02): per-family locks on the stats/pipeline/import caches (compute outside the critical sections), `_import_frame` takes the resolved bytes instead of re-reading, and a multi-threaded hammer test asserts bounds + exact byte accounting. Original finding: `engine/iris_engine/main.py:162-263, 333-345`. `_STATS_CACHE`, `_PIPELINE_CACHE` (+ non-atomic `_PIPELINE_CACHE_BYTES`), `_IMPORT_BYTES`, `_IMPORT_FRAMES` have none of the locking `_TABLE_CACHE` documents as necessary (`main.py:147-148`). Concurrent eviction + `move_to_end` → `KeyError` → 500; byte accounting drifts; `_import_frame` (`main.py:377`) re-reads after resolve → misleading 422.
- **Id-less inline tables 500 instead of 422 wherever the hierarchy materializes** — `render.py:158`, `main.py:553-556`. `hierarchy.materialize_plan` indexes `raw["id"]`; `/shape_counts` and `/reduce`'s collapse branch inject `id`, the `/reduce` level branch and `render.render()` don't. Breaks the documented FastAPI-free `render()` entry point (`render.py:26-36`).
- **Grid-complete "levels" input can't be typed into** — ✅ FIXED (2026-07-02): the box keeps its own raw text (mirroring the filter `in` input); the step only receives the parsed list. Regression test added. Original finding: `src/components/StepGridComplete.tsx:36-39`. The controlled value re-joins the parsed list per keystroke, so a trailing comma is normalized away as typed; `a`, `,`, `b` yields "ab". Multiple levels only enter by pasting. (StepCards' filter `in` input at `:77-82` handles the empty tail correctly.)
- **Latent rules-of-hooks crash** — ✅ FIXED (2026-07-02): hooks hoisted above the figure-variant early return. Original finding: `src/components/ArrayShapeNode.tsx:80-114`. The `variant === "figure" && props.sections` branch returns before two `useState` hooks; a node transitioning between the branches under one React key throws. The file's own test exercises both paths of the same component.
- **`/shape_counts` is O(n²)** — `engine/iris_engine/main.py:597-634`. The per-step loop re-runs `reduce_with_trace(df, schema, steps[:i+1])` for every prefix, then line 634 runs the full pipeline again. Applying steps incrementally (one `_apply_step` per step) is O(n). On a long pipeline over an 80k-row table this endpoint pays the full pipeline cost per node.

---

## 3. Statistics core (`engine/iris_engine/stats.py`) — detailed review

Verified correct: the two-axis test picker and its 2×2 grid; rank-resolution floors (signed-rank `2·2⁻ⁿ`, Mann–Whitney `2/C(n₁+n₂,n₁)`, Spearman `2/n!`, Kruskal–Wallis `k!·∏nᵢ!/N!` — all checked numerically and consistent with the glossary text); Welch/paired CIs; Hedges' g SE approximation; Kruskal ε² `(H−k+1)/(N−k)`; rank-biserial sign convention; Tukey-with-ANOVA / Holm-with-Kruskal pairing; the pairing machinery (`_paired_arrays` mean-combine, complete-pair alignment); Fisher's-exact recommendation rule (2×2 with expected < 5) and Haldane–Anscombe correction applied consistently to OR and CI; contingency zero-row/col dropping. The glossary (`statsGlossary.ts`) and `StatsPanel` wording match the engine's behavior.

Findings:

- **`stats.py:983-990` (`_per_unit_correlation`) — point estimate and CI on different scales.** ✅ FIXED (2026-07-02): `r_bar` is now `tanh(mean(z))`; the nested-correlation validation reference was independently recomputed (−0.911388). Original finding: `r_bar` is the arithmetic mean of per-unit *r* while the CI is back-transformed from Fisher-z (`tanh` of the z-scale interval). Convention is `tanh(mean(z))` so the estimate is centered in its own CI; as is, `r_bar` need not lie centered (or, in edge cases, even inside) the reported interval.
- **`stats.py:1285-1305` (`descriptive`) — recommendation and methods text disagree at small n.** ✅ FIXED (2026-07-02): `center` now keys on `normal and not small`; regression test added. Original finding: At n < 12 with a passing Shapiro, `reason` says "report median (IQR) to be safe" but `center` keys on `normal` alone, so `methods_text` reports mean (SD). Gate `center` on `normal and not small`.
- **Fixed `1.96` / `0.975` constants coexist with an `alpha` parameter** — `stats.py:511,519` (Welch g CI), `:893` (`_summary`), `:1002` (`_ols_band`), `:1247` (Fisher OR CI), while `:984` honors `1 - alpha`. Currently harmless — the frontend hard-codes `alpha: 0.05` (`state.ts:799`) with no UI to change it — but the API is a trap if alpha ever becomes configurable.
- **Minor dead weight:** `stats.py:787` is a no-op (`sub.assign(**{count: sub[count]})`); `rate()` re-imports `sps` (`:797`) which shadows the module-level import.

---

## 4. Low severity bugs (full list)

### Frontend
- `src/components/StatsPanel.tsx:128` — the "Reference (chance)" row's InfoTip uses glossary key `significance_stars`; should be the one-sample-test entry.
- `src/components/GuidedTestPicker.tsx:112-116` — `pick()` fills the untouched axis from the server-round-tripped `decision.<axis>.chosen`; two rapid picks before re-analysis returns silently drop the first.
- `src/components/LayerStrip.tsx:89` — `key={layer.id ?? i}` plus per-item `open` state: layers without ids bleed collapsed/expanded state on removal (`Layer.id` is optional, `types.ts:88`).
- `src/components/HierarchyPanel.tsx:33-43` — debounced hierarchy fetch has no sequence guard; out-of-order responses can leave `info` stale (contrast ImportWizard's `seq` guard).
- `src/App.tsx:240-242` — `xIsNumeric` tests `type === "numeric"` and misses `"bool"`, which `channels.ts` `colType` treats as numeric; with a bool measurement on X the pairing-flip guard's qualifier is sent wrong — the failure mode the adjacent comment says the code was written to fix.
- ~~`src/channels.ts:102-110` — `familyForMappingsRef` upgrades the `"none"`-fallback `"descriptive"` to `"location"`; a stats-unreadable mapping with a stored reference serializes the wrong family~~ (✅ fixed: the family is now derived from the axis types directly, so the `"none"` fallthrough is never upgraded — only a genuine `descriptive`/`group_comparison` flips).
- `src/state.ts:147,755-758` — `TEST_BY_FAMILY.timeseries = []` + `?? tests[0]` would put `test: undefined` in a spec typed `test: TestName`. Currently unreachable; latent trap since the engine's timeseries family exists (`statmodel.py:70`).
- `src/state.ts:676-684` (`loadDocumentAtom`) — the empty-`doc.tables` bail-out runs after clearing the pool atoms, leaving plottables dangling against a destroyed pool.
- `src/state.ts:1046-1068` — `t` captured before `await engine.distinct(...)`; a pool write during the fetch (cell edit bumping `handle.version`, second rapid role toggle) is clobbered by the stale upsert.
- `src/workbench/WorkbenchCanvas.tsx:174-199, 242-247` — Esc in focus mode also fires the `onClose` listener: `stopPropagation()` doesn't stop other listeners on the same target, and re-registration reorders them. Latent (App doesn't pass `onClose`), contradicts the comment. The `onClose` listener also lacks the `typing` guard every other key has.
- `src/workbench/Stash.tsx:19` — slot highlight compares only `kind`+`id`; with the seeded default trio, selecting the figure's Plot slot highlights the Stats slot too (both share `id: "figure"`).
- `src/workbench/paneTiling.ts:32-46` — `resizeColumns` clamp inverts when a column is already below `MIN_COL_PX`: `Math.max(-(a-minW), Math.min(b-minW, dx))` becomes a positive constant regardless of drag direction, shrinking the under-floor neighbor further.
- `src/workbench/state.ts:99-108, 136-139` — FIFO eviction in `pushStashAtom` doesn't clear `focusedStashIdAtom`; the stale id makes the canvas swallow the next Escape.
- `src/workbench/authoring.ts:60-66` + `WorkbenchCanvas.tsx:144-149` — the "stable singleton id" for terminal editor cards (`e:collapse`, `g:plain`) never matches real edge ids (`e:${from}->${to}`, `g:${fromId}`), so duplicate identical editor cards can be opened via `+`-menu and edge-click; the figure context menu adds a third id family for the same editor.
- `src/workbench/WorkbenchResize.tsx:49-54`, `src/workbench/FloatingCard.tsx:28-33` — drag loops never listen for `pointercancel`; a cancelled pointer leaves move listeners, `cursor`, and `userSelect: none` stuck.
- `src/components/StatsPanel.tsx:340` — labels `p === alpha` as "non-normal" (uses `>` not `>=`); measure-zero edge, noted for completeness.

### Engine
- `engine/iris_engine/hierarchy.py:200` (`home_level`) — `int(... .max() or 0)` crashes on an empty frame (`NaN or 0` is truthy → `ValueError`). Same hazard `_level_table._peak` (`:76-79`) explicitly guards. Reached via `pairing` at `render.py:185` before stats would 422 — a reduction that filters all rows raises an unhandled error instead of a clean message.
- `engine/iris_engine/compiler.py:1649-1681` (`_draw_distribution`) — KDE-overlay scale uses `edges[1] - edges[0]`; with `sinh` (non-uniform) bins that's the widest bin (~3× the narrowest), so the overlay/`smooth` curve height is wrong relative to the bars. Cosmetic.
- `engine/iris_engine/main.py:287-289` (`_resolve_table`) — inline-table+token path inserts into `_TABLE_CACHE` without appending to `_TABLE_CACHE_ORDER`: invisible to eviction, unbounded leak. Mitigating: the shipped frontend never sends both fields.
- `engine/iris_engine/main.py:553-566` (`/reduce`) — with both `level` and `collapse`+`grain`, `level` is applied first and the collapse plan materializes on already-collapsed output — double aggregation, contradicting the request-model comment (`main.py:88-91`). Latent: `NodeTable.tsx` sends exactly one mode.
- `engine/iris_engine/main.py:172-184, 446` — TOCTOU: `_table_identity` reads `sess.version` at request start but the snapshot is deferred behind the cache check; an interleaved edit caches version-N+1 results under the version-N key. Narrow window, single-user app.
- `engine/iris_engine/document.py:62-64, 90-91` — analyses saved as `{i:02d}-…` and loaded in lexicographic order: breaks past 99 entries (array position is identity for the frontend).

---

## 5. Dead code

### Whole files / endpoints / features
| What | Where | Evidence |
|---|---|---|
| `DataTab` component (whole file, 26 lines) | `src/components/DataTab.tsx` | zero importers (full import-graph trace from `index.html`); superseded by `NodeTable` |
| `addStepAtom`, `moveStepAtom` + private `reorder` | `src/state.ts:964,972,997` | only `state.test.ts`; UI uses `insertStepAtom` / canvas `removeStepAtom` |
| `Plottable.previewLevel` plumbing | `src/state.ts:182,298,650`; `App.tsx:206,216` | no writer anywhere — always `RAW_LEVEL`; the `level` argument the preview passes to `engine.reduce` is inert |
| `engine.sample` client + `GET /sample` | `src/types.ts:676`; `main.py:464-472` | sample-dataset flow removed; only `smoke_frozen.py` touches the endpoint |
| `POST /table` (`table_put`) | `main.py:475-479` | app never calls it (tokens come from `/import/commit` and sessions); `types.ts:657` comment is stale |
| `spec.annotations` block | `state.ts:801`, `types.ts:427` | sent on every analyze; zero engine reads (`significance_brackets` greps to nothing; real controls are `style.overrides.show_n`/`show_significance`) |
| `spec.data.filter` | `state.ts:770`, `types.ts:385` | always `[]`; engine never reads `spec["data"]` |
| `/reduce` response `summary` | `main.py:571` (`_column_summary`), `types.ts:298` | computed on every request, read by nothing — wasted per-request compute |
| `headroom-ai` npm dependency | `package.json` | never imported anywhere; odd dependency — remove |

### Unused symbols / parameters / fields
- `SessionTable.frame()` — `session.py:37-38`; zero callers.
- Importer byte-level `preview()` / `commit()` wrappers — `importer.py:343-350, 381-385`; main.py uses only the `*_from_frame` variants.
- `statmodel.infer(unit=…)` — `statmodel.py:40-44`; never passed, so the `unit and group` branches (`:96-97,174-175`) are unreachable and `model["unit"]` is always `[]`.
- `GeomDef.needs` — `geoms.py:32,119`; no engine reader (guards/compiler use `point_cap`/`aes`/`family`); frontend derives needs from `x_type`/`y_type`.
- `figure_to_svg(tight=…)` — `compiler.py:1933`; no caller passes `tight=True`.
- `session.py:12` unused `import numpy`; `main.py:808` re-imports `threading` inside `main()`.
- `fileToBase64` import + unread `clipboard` from `useAtom(styleClipboardAtom)` — `StylePane.tsx:12,77` (also subscribes the pane to needless re-renders).
- `LayerCard.registry` prop — declared and passed (`LayerStrip.tsx:58`), never used (`LayerCards.tsx:6-10`).
- `gridApiRef` — `DataTable.tsx:40,158`; assigned, never read.
- `tableEnabled` — `cardGating.ts:5,18`; constant `true`, consumed only by tests.
- `LayoutEdge.guards` — `layout.ts:14,69`; merged by `mergeGuards` but never read by `toRF`/`WorkbenchEdge` — either vestigial or guard display on edges silently regressed.
- `laneRoute` label coordinates — `WorkbenchEdge.tsx:28-45`; caller destructures `[path]` only; vestige of the removed edge label.
- `NodeTable` fetch variant `{ via: "level" }` — `explorer/graph.ts:23`, `NodeTable.tsx:165-166`; never constructed.
- `EMPTY_HIERARCHY` — `types.ts:100`; imported only by tests.
- Unused params: `makeDefaultPlottable(schema)` (`state.ts:290`), `geomSatisfiableByColumns(_reg)` (`channels.ts:230`), `_prepare(table, spec)`'s `spec` (`render.py:57-58`).
- Module-private exports with zero external importers: `DEFAULT_TYPE_COLORS` (`state.ts:82`), `TEST_BY_FAMILY` (`state.ts:120`), `CACHE_BUDGET_BYTES` (`state.ts:454`), `RENDERABLE` (`channels.ts:28`).
- Unreferenced assets: `src/assets/iris-mark-ink.svg`, `iris-mark-ondark.svg`, `iris-mark-white.svg` (likely intentional brand spares).
- `ReduceSpec.post` on the frontend type (`types.ts:287`) — nothing creates `post` steps, `buildSpec` never serializes it, `plottableFromSpec` drops it on load, yet `graphAtom.ts:149` renders it.
- `src/components/plotWizard.ts:17-18` — `if (step === "map" || step === "grain") return "done"; return "done";` — guarded branch is redundant with the fallthrough.

### Cross-layer drift (flag, don't delete blindly)
- **Post-collapse reduce phase (`reduce.post`)** is engine-complete (`render.py:86`, `/shape_counts` accepts it and returns `guards.post_aggregate_derive`, `main.py:106,662`) but frontend-unauthorable (`authoring.ts:27` declines to offer it; `buildSpec` never emits it), and `mergeGuards` (`graphAtom.ts:42-104`) silently discards the engine's `post_aggregate_derive` guard while `graph.ts:186,301` computes a local look-alike. If staged work, fine; otherwise substantial live-looking dead weight on both sides of the wire.
- **`FilterCond.bound`** (expression-valued threshold) — engine-supported (`reduce.py:116`), displayed (`graph.ts:128-130`), but no UI authors it; reachable only from hand-written `.iris` files and validation cases.

---

## 6. Unwarranted complexity / simplification

- **Duplicated from→to entries editor** — `StepRecode.tsx:8-16` vs `StepPivot.tsx:14-22`, verbatim. Extract one editor (array-based, which also fixes the duplicate-key bug in §2).
- **Four hand-rolled copies of "toggle a name, reorder by column order"** — `StepPivot.tsx:9-13`, `StepGridComplete.tsx:8-12`, `StepJoin.tsx:11-15`; `StepCards.tsx:10-11` already defines `orderBy` but doesn't export it.
- **`TEST_LABELS` defined twice** — `GuidedTestPicker.tsx:12-17` (strict subset of `StatsPanel.tsx:10-24`); drift in one won't show in the other.
- **`levelInitial` duplicated verbatim** — `workbench/nodeDelta.ts:29-32` vs `components/ArrayShapeNode.tsx:42-45`; the legend glyphs decode the bar only if they agree.
- **`guards.py:20` duplicates `stats.py:562`** — `MIN_LOCATION_N = 3` defined twice; the guard's warning threshold and the test's skip threshold can silently drift.
- **`WorkbenchCanvas.tsx:91`** — `useMemo(() => toRF(...), [graph, nodePositions])` recomputes full layout on every graph tick/drag-stop for a value `useNodesState`/`useEdgesState` ignore after first render; use a lazy initializer.
- **`main.py:637` vs `:646`** — `spine` and `present` are the identical expression computed twice, two statements apart.
- **Stale comments that misstate behavior** — `AddStepMenu.tsx:6` ("reused on drop-to-empty-canvas" — no such consumer); `Stash.tsx:12` ("canvas highlights the node" — `selectedTargetAtom` has no canvas consumer); ~~`state.ts:1044` ("a schema change re-uploads the table")~~ (✅ fixed with §1.3); `types.ts:657` ("uploaded via /table" — see §5).
- **`statsGlossary.ts:240-241`** describes "the 95% CI of the mean" and IQR for the group summary, but StatsPanel renders only n/mean/SD — the engine even ships `ci95_half` (`types.ts:479`) that no component displays. Align the panel or the prose.

---

## 7. Build / packaging

- ✅ FIXED (2026-07-02): pinned `statsmodels` (+ `patsy`) added to both files. — **`statsmodels` missing from `engine/requirements.txt` and `requirements.lock`** while `stats.py` imports it lazily (rate-family GLM, `stats.py:740,796`) and `pyproject.toml` lists it as a core dependency. An environment installed from the requirements files — including a PyInstaller build env from the lock — breaks at runtime on the rate family.
- **`npm ci` fails** — ✅ FIXED (2026-07-02): lockfile regenerated; `npm ci` passes. Original finding: `package-lock.json` is out of sync with `package.json` (missing `@esbuild/*` platform entries for esbuild 0.28.1). `npm install` works; clean/CI installs don't. Regenerate the lockfile.
- **`ENGINE_PORT` in `dev.sh` doesn't reach the frontend** — ✅ FIXED (2026-07-02): dev.sh mirrors it into `VITE_ENGINE_PORT`. Original finding: the browser client reads `VITE_ENGINE_PORT ?? 8765` (`types.ts:636`); Vite only exposes `VITE_`-prefixed vars. Non-default-port dev runs split frontend and engine. (Tauri path is correct via the `engine_port` command.)
- **`@tauri-apps/cli` devDependency** — no npm script invokes it; README documents `cargo tauri dev`. Possibly kept for `npx tauri`; confirm or drop.

---

## 8. Verified-clean areas (for the record)

`scales.py`, `shape.py`, `style.py`, `specnorm.py`, `build_info.py`, `document.py` round-trip (apart from §4's 99-entry ordering), `session.py` locking discipline within its own classes; `reduce.py` derive/pivot/join/grid-complete paths (apart from §1.2); `hierarchy.py` nested median-of-medians collapse, rate-family sum-of-sums, pairing logic (apart from §4's `home_level` crash); compiler stats/aggregation paths (`ddof=1`, `_err_half` n=0/1, bracket ordering); FigurePane's pt↔px↔mm and axes-rect y-flip math; `tables.ts`, `collapse.ts`, `levels.ts`, `testSeam.ts`, `style/sheet.ts`; the undo/redo stacks, LRU/eviction math, spine reconciliation, and `defaultPlan`/`planGrains`; `layout.ts` Kahn rank + row stacking; `nodeDelta.ts` semantics; `paneTiling.ts` (apart from §4's clamp inversion); `cannedExamples.ts`, `Guide.tsx`; `src-tauri/src/main.rs` (sidecar lifecycle is sound).

---

## 9. Priorities

1. ~~**§1.1 importer decimal sniffing**~~ (✅ fixed) and ~~**§1.2 quantile-NaN filter**~~ (✅ fixed) — the two bugs that can silently change published numbers.
2. ~~**§1.3 role-change schema drift**~~ (✅ fixed) — frontend and engine can disagree about which test ran.
3. ~~**§1.4 cache-hit guard skip**~~ (✅ fixed) and ~~**§1.5 ungrouped location**~~ (✅ fixed) — user-visible breakage on supported paths.
4. §2 items, then the dead-code sweep (§5) — most of it is mechanical deletion with test cover already green.
