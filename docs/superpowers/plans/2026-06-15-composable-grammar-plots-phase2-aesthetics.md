# Composable Grammar of Graphics — Phase 2 (Aesthetics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `color` / `size` / `shape` from inert spec slots into real aesthetic encodings — each mapped to a column, resolved through a scale, drawn by the geoms that accept it, and explained by a legend that exports identically to the figure. Statistics inference gains a single new move: a categorical `color` distinct from `x` is *surfaced* as a candidate second factor, never silently tested. Old documents keep opening; no `spec_version` bump (the 2.0 schema already carries these slots — Phase 2 activates them).

**Architecture:** Two parts that each ship working software. **Part A (engine, Tasks 1–7)** teaches the registry which channels each geom accepts, adds a scale-resolution layer to the compiler, draws per-point aesthetics (scatter/dot) and dodged group aesthetics (box/violin/bar), renders an exportable legend, and extends `statmodel.infer` to surface the second-factor question. **Part B (frontend, Tasks 8–12)** adds color/size/shape pickers to `EncodingsCard` (gated by what the active layers accept), threads the three channels through `Plottable` state and `buildSpec`, surfaces the "color could be a second factor" notice in the stats panel, and adds a guard-bar warning when a channel is ignored or a palette is exhausted.

**Tech Stack:** Python (FastAPI, pandas, scipy, pingouin, matplotlib) engine tested with `pytest`; React + TypeScript + Jotai frontend, typechecked with `tsc` and exercised by Playwright e2e scripts (`e2e/*.mjs`). Engine tests: `cd engine && python -m pytest tests -q`. Frontend typecheck: `npx tsc --noEmit`. Frontend build: `npm run build`. E2e: engine on 8765 + `npm run dev` on 5173, then `node e2e/<name>.mjs`.

---

## Key scope decisions (read before starting)

These bound Phase 2 so it stays shippable and matches the roadmap's tier ordering.

1. **Two-way ANOVA is NOT in this phase.** The roadmap puts "two-way ANOVA with proper sums-of-squares (via statsmodels)" in **Tier 3** (§6), and explicitly orders "Phase 2 (Aesthetics) precedes it." So Phase 2's stats work is *only* to **surface** that a categorical `color ≠ x` *could* be a second factor — a plain-language notice plus the existing describe-only / override controls. The inferred `family` stays one-factor (`group_comparison`/`correlation`/`descriptive`); no two-way test runs. This honors scope decision #3 of the design spec ("when ambiguous, describe — don't test") and avoids building statsmodels orchestration a phase early.

2. **`color` becomes independent of `x`.** Today `buildSpec` welds `color = x` for `group_comparison` (`state.ts:207`). Phase 2 makes `color` its own pickable channel. The *default* for a fresh group-comparison plottable stays `color = x` (so existing figures look identical), but the user can now map it elsewhere or to none.

3. **Two color regimes in comparison plots:**
   - `color == x` (today's default) → one palette color per x-group, **no dodge, no legend** (the x-axis already labels the groups). Pixel-identical to today.
   - `color == some other categorical` → marks **dodge** within each x position, one sub-series per color level, **with a legend**. This is the new capability.

4. **Channel → geom applicability (declared in the registry):**
   - `scatter`, `dot`: accept `color`, `size`, `shape` (per-point).
   - `box`, `violin`, `bar`: accept `color` only (per-group / dodged); `size`/`shape` are meaningless → guard **warning** "ignored".
   - `histogram`, `density`: accept `color` only (overlaid per-level series); `size`/`shape` ignored.
   - `regression`, `summary`: accept `color` only (one fit/marker per color level); `size`/`shape` ignored.

5. **`size` is continuous, `shape` and `color` are categorical.** `size ← numeric` (bubble area scale). `shape ← categorical` (marker cycle, capped). `color ← categorical` (discrete palette). No continuous color scale in Phase 2 (deferred — heatmaps/colorbars are out of the bounded grammar for now).

6. **Adopt Okabe–Ito as the default categorical palette here.** The roadmap lists "Okabe–Ito as the default palette for colorblind safety" as remaining styling work (§5); Phase 2 introduces the first real multi-series legend, so this is the natural landing spot. Replace `PALETTE` in `compiler.py:20` with the 8-color Okabe–Ito set. Existing single-series and ≤4-group figures shift color but stay correct; note this in the commit (it changes golden SVGs — update them deliberately).

7. **Legend is exportable and consistent with the WYSIWYG contract.** The legend is a matplotlib artist rendered at physical mm size, with `svg.fonttype:none` text (editable), and — like titles/axis labels — its position is draggable and persisted in `style.overrides.offsets` under a stable gid (`legend`). A `style.overrides.show_legend` toggle (default: auto — shown iff any channel maps to a column other than `x`).

8. **Cardinality guards.** Categorical `color`/`shape` with more levels than the palette/marker cycle (8 colors, ~6 shapes) → **warning** ("12 levels, palette has 8 — colors repeat; consider faceting"), not blocking. This is the natural lead-in to Phase 3 (Facets).

---

## File structure

**Part A — engine (`engine/triad_engine/`)**
- `geoms.py` *(modify)* — `GeomDef` gains `aes: list[str]` (accepted channels beyond x/y). `registry_payload()` emits it.
- `scales.py` *(new)* — `resolve_scales(encodings, df, schema, style)` → a `Scales` object: for each mapped channel, the levels/range and the lookup (`color_for(level)`, `size_for(value)`, `marker_for(level)`), plus legend entries. Single source the compiler and legend both read.
- `compiler.py` *(modify)* — draw context gains resolved scales; per-point geoms (`_geom_dot`, scatter) read color/size/shape per row; comparison geoms gain a dodge offset when `color ≠ x`; a new `_draw_legend(fig, ax, scales, style)`; `PALETTE` → Okabe–Ito.
- `statmodel.py` *(modify)* — read `color`; when categorical & distinct from x & not an identifier, append a `second_factor_candidate` note to `design` and an `issue` (level `warning`, code `color_second_factor`) without changing `family`/`test`.
- `guards.py` *(modify)* — channel-applicability warnings (size/shape on a geom that ignores it) and palette/marker cardinality warnings.
- `main.py` *(no change expected)* — `_run` already passes `df, schema, spec, model` through; scales resolve inside the compiler.

**Part B — frontend (`src/`)**
- `types.ts` *(modify)* — `GeomMeta.aes: string[]`; `StatModel` already carries `issues`; no schema-shape change (encodings slots exist).
- `state.ts` *(modify)* — `Plottable` gains `color`/`size`/`shape` (each `string | ""`); `makeDefaultPlottable` seeds `color = x` for group-comparison; `buildSpec` emits the three channels from the plottable; an atom to set a channel.
- `components/EncodingsCard.tsx` *(modify)* — add color/size/shape pickers below X/Y, each with a "— none —" option, gated to the intersection of channels the active layers' geoms accept (from `registry.geoms[*].aes`), and typed-column-filtered (categorical for color/shape, numeric for size). Reuse the `GroupedOptions` optgroup component already there.
- `components/StatsPanel.tsx` *(modify)* — when the model carries a `color_second_factor` issue, render the plain-language notice next to the existing describe-only / override controls.
- `App.tsx` / guard bar *(modify)* — render the new warnings (ignored channel, palette exhausted) in the existing amber warn-bar.
- `e2e/aesthetics_test.mjs` *(new)* — Playwright smoke: map color on a scatter, assert a legend appears and the figure still renders.

---

# PART A — Engine aesthetics core (independently shippable)

## Task 1: Registry declares accepted channels

**Files:** modify `engine/triad_engine/geoms.py`; test `engine/tests/test_geoms.py`

- [ ] **Step 1 (RED):** Add tests asserting `GEOMS["scatter"].aes == ["color","size","shape"]`, `GEOMS["box"].aes == ["color"]`, `GEOMS["regression"].aes == ["color"]`, and that `registry_payload()["geoms"]["scatter"]["aes"]` round-trips the list.
- [ ] **Step 2 (GREEN):** Add `aes: list[str] = field(default_factory=list)` to `GeomDef`; populate per decision #4; emit `"aes": list(g.aes)` in `registry_payload`.
- [ ] **Step 3:** `cd engine && python -m pytest tests/test_geoms.py -q` → green.
- [ ] **Step 4:** Commit `feat(engine): geoms declare accepted aesthetic channels`.

## Task 2: Scale resolution module

**Files:** create `engine/triad_engine/scales.py`; test `engine/tests/test_scales.py`

- [ ] **Step 1 (RED):** Test `resolve_scales` for: (a) categorical color → one Okabe–Ito color per level in level order, with legend entries; (b) numeric size → an area scale mapping min→`size_min` and max→`size_max`; (c) categorical shape → markers from a fixed cycle, capped; (d) no channels mapped → an identity/empty Scales whose `color_for` falls back to `style["palette"][0]`. Golden values, not approximate.
- [ ] **Step 2 (GREEN):** Implement `resolve_scales(encodings, df, schema, style) -> Scales`. `Scales` exposes `color_for(level)`, `size_for(value)`, `marker_for(level)`, `legend_entries()` (a list of `{channel, label, swatches}`), and `mapped` (which channels are active). Levels for categorical channels come from the schema column's `levels` (falling back to sorted uniques).
- [ ] **Step 3:** `python -m pytest tests/test_scales.py -q` → green.
- [ ] **Step 4:** Commit `feat(engine): aesthetic scale resolution (color/size/shape)`.

## Task 3: Okabe–Ito default palette

**Files:** modify `engine/triad_engine/compiler.py`; update affected golden SVG tests.

- [ ] **Step 1:** Replace `PALETTE = [...]` (`compiler.py:20`) with the 8-color Okabe–Ito set. `_group_color` indexes it modulo length (so >8 groups wrap — Task 7 warns).
- [ ] **Step 2:** Run the full engine suite; **deliberately** update any golden SVG/color assertions that change (they assert correctness of *which* color, not the specific hex — confirm each diff is only a palette swap, not a structural change). Note the intentional change in the commit body.
- [ ] **Step 3:** Commit `feat(engine): Okabe–Ito default palette for colorblind-safe series`.

## Task 4: Per-point aesthetics — scatter & dot

**Files:** modify `engine/triad_engine/compiler.py`; test `engine/tests/test_aesthetics.py`

- [ ] **Step 1 (RED):** Tests: a scatter with `color ← group` emits N sub-series (one gid group per color level) whose `point_groups` partition the rows correctly (click-to-exclude contract preserved); `size ← numeric` varies marker area; `shape ← group` varies marker; with no channels the output is unchanged from today (structural check vs a captured baseline).
- [ ] **Step 2 (GREEN):** In `build_scatter_figure` and `_geom_dot`, resolve scales once, then draw one `ax.scatter` call per (color×shape) sub-series with per-point `s=` from the size scale. Set a stable gid per sub-series (`pts-{ci}-{si}`) and emit one `point_groups` entry each. When no channel maps, the single-series path is byte-for-byte today's.
- [ ] **Step 3:** `python -m pytest tests/test_aesthetics.py tests/test_engine.py -q` → green (the gid/row-id contract test in `test_engine.py` must still pass).
- [ ] **Step 4:** Commit `feat(engine): per-point color/size/shape on scatter and dots`.

## Task 5: Dodged group aesthetics — box/violin/bar/dots

**Files:** modify `engine/triad_engine/compiler.py`; extend `engine/tests/test_aesthetics.py`

- [ ] **Step 1 (RED):** Test that a box plot with `x = condition`, `color = genotype` (2 levels) draws 2 dodged boxes per x position at offsets ±w/2, colored by genotype; and that `color == x` produces the **un-dodged, today-identical** layout (no regression).
- [ ] **Step 2 (GREEN):** Extend `_comparison_context` to compute, when `color` is a categorical column ≠ x, a nested grouping (x-level × color-level) and a per-sub-group dodge offset; geom render fns (`_geom_box/_geom_violin/_geom_bar/_geom_dot/_geom_summary`) draw at `gi + dodge` with `scales.color_for(color_level)`. When `color` is unmapped or `== x`, the existing single-series-per-x path runs untouched (guard on a `dodged` flag in the context).
- [ ] **Step 3:** `python -m pytest tests/test_aesthetics.py -q` → green.
- [ ] **Step 4:** Commit `feat(engine): dodged group series when color maps a second factor`.

## Task 6: Exportable legend

**Files:** modify `engine/triad_engine/compiler.py`; extend tests.

- [ ] **Step 1 (RED):** Test that a figure with a mapped color emits a legend artist with one entry per level, the SVG contains the level labels as real text (`svg.fonttype:none`), the legend carries gid `legend`, and `show_legend=False` suppresses it. Test that `color == x` shows **no** legend (decision #3).
- [ ] **Step 2 (GREEN):** Add `_draw_legend(fig, ax, scales, style)` reading `scales.legend_entries()`; auto-show iff any channel maps a column ≠ x; respect `style["show_legend"]` override; tag gid `legend` and apply any `offsets["legend"]` drag (reuse the existing offset-application path used for titles/labels).
- [ ] **Step 3:** `python -m pytest tests/test_aesthetics.py -q` → green.
- [ ] **Step 4:** Commit `feat(engine): exportable, draggable legend for aesthetic channels`.

## Task 7: Stat-model surfacing + channel/cardinality guards

**Files:** modify `statmodel.py`, `guards.py`; tests `test_statmodel.py`, `test_guards.py`

- [ ] **Step 1 (RED):**
  - `statmodel`: with `x = condition` (categorical), `y` numeric, `color = genotype` (categorical, ≠ x), `infer` returns `family == "group_comparison"` (UNCHANGED) **and** an `issues` entry `{level:"warning", code:"color_second_factor", message: "...could be a second factor..."}` and a `design` sentence that mentions it. With `color == x` or `color` unmapped, no such issue.
  - `guards`: `size`/`shape` mapped while the only layers are box/bar → warning `channel_ignored`. A categorical `color` with > palette length levels → warning `palette_exhausted`.
- [ ] **Step 2 (GREEN):** Implement both. Keep `statmodel` changes additive — `family`/`test` logic for x/y is untouched (decision #1).
- [ ] **Step 3:** `python -m pytest tests/test_statmodel.py tests/test_guards.py -q` → green.
- [ ] **Step 4:** Commit `feat(engine): surface color-as-second-factor; channel + cardinality guards`.

**End of Part A:** the engine renders color/size/shape and a legend, dodges a second categorical factor, ships Okabe–Ito, and explains (never silently tests) a candidate second factor — all behind spec slots the frontend doesn't yet populate beyond `color=x`, so nothing regresses.

---

# PART B — Frontend channel pickers (independently shippable on top of Part A)

## Task 8: Channels in Plottable state + buildSpec

**Files:** modify `src/state.ts`, `src/types.ts`

- [ ] **Step 1:** Add `color: string; size: string; shape: string` to `Plottable` (`""` = none). `makeDefaultPlottable`: `color = x` for `group_comparison`, else `""`; `size`/`shape` `""`. `duplicatePlottableAtom` copies them.
- [ ] **Step 2:** `buildSpec` emits `encodings.color/size/shape` from the plottable (`col ? {column: col} : null`) instead of deriving color from x. Add a `setChannelAtom({channel, column})` write atom.
- [ ] **Step 3:** `GeomMeta.aes: string[]` in `types.ts`.
- [ ] **Step 4:** `npx tsc --noEmit` clean. Commit `feat(state): color/size/shape as independent plottable channels`.

## Task 9: Channel pickers in EncodingsCard

**Files:** modify `src/components/EncodingsCard.tsx`

- [ ] **Step 1:** Below X/Y, render a picker per channel the **active layers** accept (intersection of `registry.geoms[layer.geom].aes` across the stack). Each picker: a "— none —" option + grouped column options (`GroupedOptions`), filtered by type — categorical for color/shape, numeric for size. Wire to `setChannelAtom`.
- [ ] **Step 2:** If no layer accepts a channel, hide that picker. If a channel is set but no layer accepts it, still show it (so the user can clear it) — the engine warns via the guard bar.
- [ ] **Step 3:** `npx tsc --noEmit` + `npm run build` clean. Commit `feat(ui): color/size/shape pickers gated by layer capabilities`.

## Task 10: Stats-panel second-factor notice + guard bar

**Files:** modify `src/components/StatsPanel.tsx` and the guard-bar render in `App.tsx`

- [ ] **Step 1:** When `stat_model.issues` contains `color_second_factor`, render its message as an inline notice beside the describe-only/override controls (links the user to the override they'd use). When guard `issues` contain `channel_ignored` / `palette_exhausted`, render them in the amber warn-bar (Part A returns them in the 200 response `issues`).
- [ ] **Step 2:** `npx tsc --noEmit` clean. Commit `feat(ui): surface second-factor notice and channel/palette warnings`.

## Task 11: E2e smoke

**Files:** create `e2e/aesthetics_test.mjs`

- [ ] **Step 1:** Script: Analyses mode → seed a scatter (or pick a 2-numeric sample) → set `color` to a categorical column via the new picker → assert a `.legend`/legend text appears in the figure SVG and no hard `.error-bar`. Mirror `e2e/layers_test.mjs` structure.
- [ ] **Step 2:** Run against live engine (8765) + `npm run dev`; expect exit 0. Stop the engine afterward.
- [ ] **Step 3:** Commit `test(e2e): aesthetic color encoding renders a legend`.

## Task 12: Migration check + roadmap update

**Files:** verify `migrateSpec` (`types.ts`); modify `ROADMAP.md`

- [ ] **Step 1:** Confirm a legacy 1.3 `.viz` (mappings.color welded to x) still opens and renders — `migrateSpec` already maps `mappings.color → encodings.color`; add a test fixture if none covers a non-x color.
- [ ] **Step 2:** Update `ROADMAP.md`: mark **Phase 2 (Aesthetics) shipped**, note Okabe–Ito landed, and that **Phase 3 (Facets)** is the next grammar cycle (and that two-way ANOVA — the stats partner to color-as-factor — remains Tier 3).
- [ ] **Step 3:** Commit `docs: Phase 2 (Aesthetics) shipped; reconcile roadmap`.

---

## Done — Phase 2 complete

Color, size, and shape are real, pickable encodings resolved through scales and drawn by the geoms that accept them; a second categorical factor dodges the group marks and earns an exportable, draggable legend; Okabe–Ito is the default palette; and a categorical color distinct from x is *surfaced* as a candidate second factor — explained in plain language, never silently tested (the two-way test itself stays Tier 3). Phase 3 (Facets) extends the same `facet` block and per-facet stat-model seam.

## Open questions for the implementer

1. **Size scale range.** Pick `size_min`/`size_max` (pt² area) defaults that read well at thesis-figure mm sizes — propose 10–120 pt², expose as style overrides if needed.
2. **Shape cycle.** Fix the marker order (`o, s, ^, D, v, P`) and cap; decide blocking vs warning past the cap (recommend warning, wrap).
3. **Legend placement default.** Outside-right vs inside-best-loc — recommend matplotlib `loc="best"` inside the axes for WYSIWYG mm fidelity, draggable to taste.
