# TODO

Ordered easy → hard.

## Bugs & UX issues reported 2026-06-16

### 1. Color palette clips in fullscreen — FIXED 2026-06-16
The styling tab's color palette was swapped from the native `<input
type="color">` (whose OS panel clips in fullscreen) to a custom popover in
`400fcd9`, but that popover still positioned itself with a fixed `top =
swatch.bottom + 4` and never clamped to the viewport, so it still ran off the
bottom edge when the swatch sat low on screen (taller fullscreen window). Fixed:
`StylePane` now measures the popover after render (`useLayoutEffect` + ref) and
flips it above the swatch / clamps it to the screen edges so it never clips.

### 2. Empty start page — FIXED 2026-06-16
`400fcd9` made `DataTable` show "Import or enter data to start." instead of
rendering nothing when there's no schema. The data view is the default on a
fresh start, so the prompt (the TODO's stated minimum) shows immediately; the
"Enter data…" wizard covers manual entry.

## e2e suite is broken (found 2026-06-16, unrelated to Phase 3 itself)

### 3. e2e suite is broken — FIXED & VERIFIED 2026-06-16

`111243b` (fix(ui): blank startup, categorical×categorical crash, ghost
figure) removed the sample-dataset auto-fetch on startup, removed the
`.template-pick` layer-seed dropdown, and stopped auto-seeding a layer/mapping
on a fresh plottable — but didn't update the e2e tests that depended on those,
so all five tests in `e2e/` broke.

Resolved: each test now imports a small fixture CSV via the `ImportWizard`'s
hidden file input (`setInputFiles`) before touching the rails, the
`.template-pick` usage was replaced with the `.add-layer-btn` flow, and
`layers_test.mjs` adds its first layer explicitly instead of assuming one is
seeded. Verified by running all five against a live engine (8765) + vite
(5173) on a machine with a Chromium binary — `layers`, `plottables`,
`aesthetics`, `drag`, and `resize` all exit 0.

## Bugs & UX issues reported 2026-06-16 (continued)

### 4. Color mismatch between styling tab and plot — FIXED 2026-06-16
Root cause: the frontend `DEFAULT_PALETTE` (`src/state.ts`) had drifted from the
engine's default `compiler.PALETTE` (Okabe–Ito) despite a comment claiming they
must match. With no palette override the style panel showed its own four colors
(teal/orange/green/purple) while the engine drew the Okabe–Ito eight. Fixed by
restoring `DEFAULT_PALETTE` to the exact Okabe–Ito values, so the unset swatches
match the drawn colors (and the first color edit no longer freezes wrong
defaults for the other series). Once a color is explicitly chosen it was already
sent through to the engine, so that path always matched.

### 5. Live preview vs final render mismatch on resize — FIXED 2026-06-16
Root cause: the injected `<svg>` kept the default
`preserveAspectRatio="xMidYMid meet"`, so during a corner drag `FigurePane`
resized the SVG's *box* but the vector content only letterboxed — keeping the
aspect ratio constant. The final render re-lays-out at the new w×h mm, so its
shape changes. `maxWidth: 100%` also clamped the previewed box to the pane
width, distorting the previewed proportions. Fixed: during the drag the SVG is
stretched to the target box (`preserveAspectRatio="none"`, `maxWidth` lifted) so
the preview reflects the new aspect ratio; on release the fit-display is
restored and the engine re-renders. (The preview stretch is an approximation —
the engine keeps font/margin sizes fixed and only the plot area changes — but it
now conveys the correct target shape instead of a constant one.)

### 6. Add-layer menu should filter by encoding compatibility — FIXED 2026-06-16
The gating logic (`geomGateReason`) already existed, but the add-layer menu
showed incompatible geoms *disabled-with-reason* rather than hiding them. Now the
add menu (`LayerRail`) offers only geoms whose `(x_type, y_type)` is satisfied by
the current encoding; incompatible ones are hidden, with a "N more hidden —
incompatible with the current encoding" note and an empty-state hint ("map X / Y
to enable layers") so the filtering is discoverable. The retype dropdown keeps
its disabled-with-reason behavior (there, seeing why a switch is blocked helps).

### 7. Auto scale picker too sensitive to outliers — FIXED 2026-06-16
Matplotlib already autoscales the value axis to the drawn artists (so a bar plot
on its own ignores undrawn outliers). The leak was the significance bracket: it
was anchored at `ctx["top"] = max(ys.max(), mean+err)` — the raw data max,
outliers included — then `set_ylim` stretched the axis to fit the bracket above
an undrawn outlier. Fixed by dropping the precomputed `top` and anchoring the
bracket on `_drawn_value_max(ax)`, read from `ax.dataLim` after the geoms draw —
so the anchor includes outliers only when they're actually drawn (box fliers /
dot layer) and not for bar/summary. Verified: a bar plot with a 100-value
outlier now tops out at y≈5 (drawn extent) while a dot plot of the same data
extends to ≈119 (the drawn outlier). All 167 engine tests pass.

### 8. Analysis / Pipeline / Encoding bars: unify style + collapsible — FIXED 2026-06-16
The Pipeline rail was already a panel card with a `rail-head` (title + `⟨`
collapse) and a `⋮` expand pill. The Analyses sidebar (`PlottableSidebar`) had no
head/collapse and the Encoding & layers rail (`LayerRail`) had a head but no
collapse, and used a different chrome (`border-right`, not a card). Now all three
share: the panel-card style, a `rail-head` with a `⟨` hide button, and a
collapsed state rendering the vertical `rail-expand` pill (`⋮ Analyses` /
`⋮ Pipeline` / `⋮ Encoding`). CSS for `.plottable-sidebar`/`.layer-rail` was
aligned to `.pipeline-rail` with matching `.collapsed` widths.

### 9. Shape/size encoding broken in dot plots — FIXED 2026-06-16
The dot geom declared `aes=["color","size","shape"]` (so no "channel ignored"
warning) but `_geom_dot` only ever drew a fixed `marker_size` and a circle —
size/shape mappings were silently dropped. Fixed: `_comparison_context` now
carries per-row size/shape values into each group (`_aes_arrays`), and
`_geom_dot` varies marker area by the size value and splits each group's rows
into one scatter call per shape level (matplotlib takes one marker per call),
each emitting its own point-group. gid numbering moved off the fixed group count
onto the actually-drawn series count (`gid_start` + emitted count), so shape
splits stay unique across facet cells and the gid→row-ids click/exclude contract
holds. The existing size/shape legend entries now render automatically. Verified:
size spans 10→120 pt², shape yields distinct markers, row-ids stay complete.

### 10. Define the independent-repetition key (n for stats) — RESOLVED 2026-06-16 via Phase 5 (Superplots)

RESOLVED: Phase 5 shipped the visible half. A layer-level per-unit stat
(`Layer.stat = {per_unit}`) draws one mark per independent unit over the raw
replicates; a per-unit `summary`/`bar` reports the mean of unit means with
unit-level error; a one-click "Build superplot" lays down the canonical raw +
per-unit + summary stack. The unit columns still come from `stats.repetition_key`
(this item's stats plumbing, unchanged), so the visible marks and the test's n
share one declaration. The three open design questions below are settled: (1)
box/violin/dot **keep** raw marks + a composable per-unit overlay (option B); (2)
the template carries a summary so n/error are visible there, not forced globally;
(3) mean of unit means, unit-level error. Engine: `compiler._layer_units` /
`_unit_summary` / `_draw_unit_dots`, `geoms.accepts_stat`, `statmodel` unit echo;
tests in `engine/tests/test_superplot.py` (177 engine tests green) +
`e2e/superplot_test.mjs` (unverified — no Chromium). Design:
`docs/superpowers/specs/2026-06-16-superplots-design.md`. The paired-design gap
(rep-key units spanning both groups ⇒ paired test) still folds into the later
`pair_by` / single-inferential-unit work. History below kept for context.

DEFERRED: the stats plumbing is correct and stays, but the reopened complaint
(the *visible* effect is too weak on box/violin/dot) cannot be settled in
isolation — the conclusive fix is the **superplot** rendering pattern (Lord et
al. 2020): de-emphasized raw replicates + a prominent per-unit overlay (one mark
per independent unit, error/test bound to it), always-on across geoms, so n
becomes "count the big marks." That is a layer-level summary stat, which is
exactly **Phase 5 (Superplots)** in `ROADMAP.md` (search "Phase 5 — Superplots").
Resolve the three open design questions there, as part of that work; the paired-
design gap (rep-key units spanning both groups ⇒ the test should be paired, not
Welch/Mann–Whitney) is folded into Phase 5's `pair_by` / single inferential-unit
concept. Until then the engine keeps option B (raw plot, unit-level stats); the
plumbing below stays as the foundation Phase 5 builds on.

REOPENED: the wiring works but the *visible* effect is too weak/under-specified.
Verified end-to-end that with a repetition key the engine collapses to units and
that flows to: the test (n, recommended test, p), the per-group n-label
(`n = 3` not `n = 12` in the SVG), and **bar/summary error bars** (recomputed
from unit-level summaries). BUT box / violin / dot draw the raw distribution, so
on those geoms the only change is the small n-label — which reads as "n does
nothing." Open design questions to settle before re-closing:
- When a rep key is set, what should box/violin/dot show? Options: (A) collapse
  the *plotted* data to one point/box per unit too (clearest, but loses the raw
  technical-replicate view); (B) keep raw marks but overlay a unit-level summary
  (mean ± error) so the inference basis is visible; (C) current — raw marks,
  unit-level n-label + bar/summary error only.
- Should the n-label / error bars *always* be shown when a rep key is set, so the
  effect is unmistakable regardless of geom?
- Confirm the error-bar/label semantics are statistically what we want (mean of
  unit means; error from unit-level SEM/CI).
Current (option B for bar/summary) implementation kept below as the starting
point; the engine plumbing (`stats._aggregate_reps`, `rep_key` params,
`main._run`, `spec.stats.repetition_key`, frontend `RepetitionKey` control) and
tests (`engine/tests/test_repetition_key.py`) stay.

Prior note (kept): Decision (raw plot, unit stats): when a repetition key is set, the figure keeps
showing the raw points, but n / error bars / the test are computed on data
collapsed to one value per independent unit — the biology case (show technical
replicates, infer on biological replicates), which is why it's distinct from a
Collapse pipeline step (that would also collapse the plot). How replicates are
combined into a unit value is left to the Collapse step's concern; the stats use
a mean.

Implementation:
- Engine `stats._aggregate_reps` collapses to (grouping × repetition-key) means;
  `group_comparison` + `describe_groups` take a `rep_key` and aggregate first, so
  n, the recommended/chosen test, the summaries, and the bracket all count units.
  `main._run` reads `spec.stats.repetition_key`, drops keys removed by the
  reduction, and threads it in. The compiler is untouched: the dot geom still
  draws raw rows while bars/means/error/n read the unit-level `res`, so option B
  falls out for free. `methods_text` notes the n basis.
- Frontend: `Plottable.repetitionKey` (round-tripped via duplicate + buildSpec →
  `stats.repetition_key`); a new `RepetitionKey` control (shown only for group
  comparisons, in the Encoding & layers rail) offers the identifier/categorical
  columns as checkboxes and shows "n = unique X per group; replicates averaged".
- Tests: `engine/tests/test_repetition_key.py` (n collapses to units, unit means
  match manual aggregation, describe path honors it, /analyze threads it). 171
  engine tests pass; frontend tsc/build clean.

### 11. Stale plots when data/stats should be removed — FIXED 2026-06-16
Traced to the render-invalidation path. The engine raises HTTP 422 for a config
that can't render (reduction error, blocking guard, or a stats error like "needs
exactly 2 groups"), so `engine.analyze` throws into App's catch block — which set
`renderError`/`status="error"` but never cleared the stored analysis, so the old
figure/stats stayed in the atom. Compounding it, `FigurePane`'s SVG-injection
effect early-returned on a null analysis without clearing `host.innerHTML`, and
the error/empty overlay is a `position: static` block (not a cover), so a
leftover SVG would render beside the error. Two fixes: (1) App clears the target
plottable's analysis (`setAnalysisById({id, res:null})`) on a genuine error
(cache-miss 409 still just retries); (2) `FigurePane` clears the host SVG and
resets state whenever there's no analysis. Now an invalidating config change
drops the old figure/stats and shows the error (or the "map Y" placeholder)
instead of a stale plot.

### 12. Facets cannot be plotted — PARTIALLY FIXED / REOPENED (facet ROW) 2026-06-16

REOPENED for facet ROW: still doesn't work in the running app. What I could
verify headlessly all passes, so the remaining bug is app/browser-side and not
reproducible in this sandbox (no Chromium):
- Engine renders facet row in isolation (`build_comparison_figure`, 2 axes,
  tall figsize, no warnings) and via `POST /analyze` (200, both level labels in
  the SVG), for box/dot/scatter/tile. `tests/test_facets.py` exercises
  `facet_row="site"` across grid-shape, per-cell data, unique gids, scatter and
  tile — all green.
- Frontend wiring is symmetric with facet col (`EncodingsCard` FACET_KEY
  facet_row→facetRow; `state.buildSpec` facet.row = p.facetRow).
Likely candidates to check WITH a browser: (a) the per-cell sizing below makes a
facet-row figure very tall (height_mm × n_rows) — it may overflow/clip the
figure pane or render as an unusable sliver, so the *display* (not the data) is
the failure; (b) a console error when the facet-row select changes. NEXT: repro
in the app, capture the console + the produced figure height, and decide whether
to cap total figure size (see the sizing trade-off noted below) and/or fix the
figure-pane display of very tall figures. The col-facet sizing fix below stands.

Original (facet sizing, col path verified):
Root cause: `_build_grid` passed a *fixed total* `figsize=(width_mm, height_mm)`
to `plt.subplots` no matter how many facet cells, so every cell shrank as the
grid grew (8 cols → ~45 px wide) until constrained_layout couldn't fit the
fixed-size chrome (ticks, per-facet titles, shared legend) and collapsed the
axes to zero — the "axes sizes collapsed to zero" warning + a blank figure.
Fixed by treating width_mm/height_mm as the *per-cell* size: `figsize =
(width_mm·n_cols, height_mm·n_rows)`, so the figure grows with the grid
(small-multiples convention) and the 1×1 unfaceted path is unchanged. Verified:
cell width stays ~360–427 px for 1/2/4/8 cols (was 45 px at 8) and the collapse
warning is gone. Also guarded the `style["y_min"]/["y_max"]` apply against a
degenerate `y_min == y_max` (the "identical low and high ylims … singular"
warning). All 167 engine tests pass.

## No Phase 3 (Data-First Encodings) e2e coverage

### 13. No Phase 3 e2e coverage — TESTS ADDED 2026-06-16 (execution pending)

Added three UI-wiring e2e tests mirroring the verified `aesthetics_test.mjs`
pattern (explicit import via the ImportWizard hidden file input → switch to
Analyses → map X/Y → `.add-layer-btn` flow):
- `e2e/continuous_color_test.mjs` — categorical X + numeric Y + numeric Color on
  a Dots layer draws a colorbar (label = column) and NO discrete legend.
- `e2e/horizontal_test.mjs` — numeric X + categorical Y offers + renders a
  horizontal Box with the categorical levels as y tick labels.
- `e2e/tile_test.mjs` — categorical X × categorical Y offers only the Tile geom
  and renders the contingency figure (the `TEST_BY_FAMILY` contingency-key crash
  class from `111243b` that only surfaces through the UI).
They also exercise the item-6 add-menu filtering (each adds a geom the menu
offers for that encoding). All three pass `node --check`.

NOTE: not executed here — this sandbox has no Chromium binary and no network to
download one (`playwright install chromium` fails), the same constraint item 3
called out. Run on a machine with Chromium: start the engine (8765) + vite
(5173), then `node e2e/continuous_color_test.mjs` (and `horizontal_test.mjs`,
`tile_test.mjs`); each exits 0 on success.

## Bugs & UX issues reported 2026-06-16 (batch 2)

### 14. Column grouping by `.` separator is broken — FIXED 2026-06-16
Root cause: `importer._sanitize_names` cleaned labels with `re.sub(r"\W+", "_",
…)`, and `\W` matches `.`, so `cell_shape.area` was imported as
`cell_shape_area`. The column picker's `groupByPrefix` (`src/components/
ColumnPicker.tsx`) groups on the `.` separator, but no imported name ever
carried one — so every column fell under "(other)" and grouping appeared dead.
Fixed by preserving `.` in the sanitizer (`re.sub(r"[^\w.]+", "_", …)`, trim
stray leading/trailing `_`/`.`); `_looks_like_identifier` already split on
`[._]`, and nothing downstream uses `df.query`/`df.eval` (which would choke on
dotted names), so the change is safe. Regression test:
`test_import_preserves_dotted_family_names`.

### 15. No "load .viz" option yet — FIXED 2026-06-16
The engine already had both `/document/save` and `/document/load` (and a tested
round-trip), and `migrateSpec` existed but was unused — the gap was purely the
frontend, which only had "Save .viz". Added a "Load .viz" button + hidden
`.viz` file input in the header (`App.doLoad`): reads the file, calls
`engine.loadDocument`, runs each saved analysis through `migrateSpec` (so older
`.viz` files still open), and dispatches the new `loadDocumentAtom`. Because the
document stores compiled `AnalysisSpec[]` (not the editable `Plottable`s), added
`plottableFromSpec` — the inverse of `buildSpec` — so a loaded analysis comes
back fully *editable*, not just renderable (encodings, facets, layers, reduce
pipeline, style/preset, and the test choice via `chosen_by`→`override`/
`describeOnly`; `previewLevel` resets to raw). `loadDocumentAtom` restores the
table, the shared hierarchy (off the first spec, falling back to identifier
columns for old files), and the exclusion log from provenance, then rebuilds the
plottables and switches to the Analyses view when the file carries any. tsc +
vite build clean; engine save/load round-trip (incl. exclusions/provenance)
verified via TestClient. NOTE: the browser file-open gesture isn't click-tested
here (no Chromium — same as items 3/13).

### 16. Add the fourth data type (bool for stochastic-event counts) — FIXED 2026-06-16
We need to add the fourth data type — a bool, for counts of stochastic events.

FIXED. A `bool` is a first-class schema type at the **import-detection** and
**presentation** layers, and collapses to **numeric 1/0** for every compute path
— so a summary/bar of a bool reads as the *fraction of trues* (the count of
stochastic events). This kept the compiler/stats/guards/hierarchy/reduce code
untouched: the single normalization site is `main._load_frame`, which coerces a
`bool` column to numeric and rewrites a *copy* of the schema to `numeric` before
anything downstream sees it.
- Engine `importer`: `_infer_type` detects bool *before* numeric when a column's
  non-null values are a subset of an unambiguous true/false vocabulary
  (`true/false/yes/no/t/f`, case-insensitive — deliberately NOT `0/1`, so a real
  numeric 0/1 measure isn't hijacked; a user can still retype one to bool).
  `_typed_columns` emits JSON booleans (`_parse_bool`); `_column_report` reports
  `n_unparsed` for a manually-retyped non-bool column.
- Frontend: `ColumnDef.type` gains `"bool"`; `channels.colType`/`offeredColumns`
  map bool→numeric so every channel offers it and the value axis derives the
  numeric family; `DataTable` colour-codes it (`type-bool`, rust, configurable
  via `DEFAULT_TYPE_COLORS` per item 21) and renders/edits true/false via a
  select; `ImportWizard` lists "bool (T/F)" and a type-aware unparsed warning;
  `HierarchyPanel`/`StepCards` count bool among the numeric measures (so it's
  aggregatable: mean → fraction true). `index.css` adds the three `.type-bool`
  rules item 21 anticipated.
Tests: `test_import_bool_type_plots_as_fraction` (detect → commit booleans →
group means equal the per-group fraction of trues); a frontend channels case
(bool offered on Y, derives `group_comparison`). 213 engine tests + 30 frontend
tests pass; tsc + vite build clean.

### 17. Draggable plot legends — FIXED 2026-06-16
The legend was already gid-tagged `legend` and the frontend label-drag writes
`offsets[gid]`, but two gaps: (a) the frontend `DRAGGABLE` list omitted
`legend`, so it was never grabbable; (b) the engine applied the legend offset
via `leg.set_transform(... ScaledTranslation)`, which a legend *ignores* — it's
positioned by its loc/anchor at draw time, so the offset was a silent no-op
(verified: the SVG legend group got no transform). Fixes:
- Frontend: added `legend` to `DRAGGABLE` (`FigurePane`); it now gets the same
  transparent hit-rect + pointer-drag → `offsets.legend` write as the labels.
- Engine: `_draw_legend` stashes the offset; new `_apply_legend_offset` (called
  from `figure_to_svg`/`figure_to_bytes`) draws once to resolve the auto
  ('best'/'outside') position, shifts its lower-left by the offset (points→px, y
  flipped to the SVG/label convention), re-anchors via `leg._loc` as an
  anchor-fraction tuple, then freezes the layout engine so the final save
  doesn't relayout it away (constrained_layout otherwise undid the x-shift). The
  stash is popped on first apply, so SVG-then-PNG export doesn't double-nudge.
Tests: `test_legend_offset_moves_the_drawn_legend`,
`test_legend_offset_idempotent_across_saves`. 212 engine tests pass; tsc + vite
build clean. NOTE: engine verified headlessly (the legend marker moves in the
rendered SVG by the offset); the browser drag gesture itself isn't click-tested
here (no Chromium — same constraint as items 3/13), but it reuses the
already-shipped label-drag path.

### 18. More colors — FIXED 2026-06-16
The group palette was the 8-color Okabe–Ito set, and `_group_color` wraps with
`i % len(palette)`, so a 9th+ series repeated colour 0. Extended both the engine
`compiler.PALETTE` and the frontend `DEFAULT_PALETTE` (kept in sync per item 4)
to 16 colours: the original Okabe–Ito 8 lead unchanged (so ≤8-series plots and
the style swatches look identical and stay colourblind-safe), followed by 8 of
Paul Tol's qualitative hues for 9–16 series. The style panel renders one swatch
per *series* (not per palette entry), so it's unaffected; users can still
override any colour. 209 engine tests pass; tsc clean.

### 19. "Pipeline" rail is over-claiming screen space — FIXED 2026-06-16
The analyses view had three left rails before the figure — Analyses (200px),
Pipeline (280px, the widest), Encoding & layers (250px) — and Pipeline, now just
Filter rows + Select columns (Collapse moved to the data hierarchy), usually sat
empty. Decided (with the user) to merge it into the Encoding & layers rail
rather than collapse-by-default or move to a popover. `PipelineRail` →
`PipelineSection` (file renamed): the rail chrome/own-column is gone; it's now a
collapsible "Data" section at the foot of `LayerRail`, separated by a hairline,
defaulting open iff there are steps and showing a "{n} steps / full table"
summary when collapsed. The add button reads "+ Filter / Select". This reclaims
the entire 280px column for the figure. Dead `.pipeline-rail` CSS removed; step
card/list styles reused. tsc + vite build clean. NOTE: layout not click-tested
in a browser here (no Chromium — same as items 3/13).

### 20. "Paired" detector false-positive — FIXED 2026-06-16
Symptom: comparing `class_label` (positive/negative) was reported as *paired*
even though no cell carries both labels (verified on `cells_by_frame.csv`: 0/1726
cells span both labels).

Root cause (`hierarchy.pairing`): `class_label` is single-valued per cell, so its
`home_level` is `cell_id`; `unit_cols = spine[:home_idx]` then drops `cell_id` and
pairs across the *parent* (`position_id`). The completeness test only asked
whether each unit *contained* both labels (`qlevels.issubset(...)`) — and every
field of view holds both positive and negative cells — so all 27 positions read
"complete" ⇒ `verdict: paired`. Containment ≠ pairing: those are *different*
cells; `class_label` partitions the cells, it doesn't cross them.

Fix: pairing now requires the qualifier to *cross* a within-unit sub-identity —
the same `home`-level entity (here a `cell_id`) observed under every level — not
mere containment via different sub-units. A unit is paired-complete only if it
has ≥1 such crossing sub-identity. The genuinely-paired fixtures still pass
(`rep=0` recurs under both A and B within a subject ⇒ crosses), and the user's
data now reports `unpaired` (`n_units=27, n_complete=0`). Regression test:
`test_pairing_nested_partition_is_unpaired`. All 207 engine tests pass.

KNOWN TRADE-OFF (folds into Phase 5 `pair_by`, see item 10): a designed pairing
where each unit has exactly *one* matched sub-unit per level (e.g. one treated +
one untreated sample per subject, the sample nested in treatment) is now read as
*unpaired*, since no sample is seen under both levels — structurally identical to
the cell/label case and only separable by count/balance (the deferred option-2
heuristic). Acceptable default: prefer a false "independent" (conservative) over a
false "paired"; the user can still override to a paired test when one applies.

### 21. Color-code data types in the table overview — FIXED 2026-06-16
The `DataTable` headers now carry a per-type colour: a tinted top accent
(`box-shadow` inset) plus a coloured header label, keyed by `type-{numeric,
categorical,identifier}` `headerClass` and driven by CSS vars set on the grid
host. The type→colour map is app-level configurable and persisted: a new
`typeColorsAtom` (`atomWithStorage`, key `iris.typeColors`, defaults in
`DEFAULT_TYPE_COLORS`) backs a compact legend in the Data pane head where each
swatch is a `<input type="color">` — clicking it recolours that type everywhere
and survives reloads. tsc + vite build clean. When the bool type lands (item
16) it just needs an entry in `DEFAULT_TYPE_COLORS` + the three CSS rules.

### 22. Progressive import: headers first, stats after — FIXED 2026-06-16
Two-phase preview. Engine: a new `/import/headers` parses only a head sample
(`importer.read_header_frame`, `HEADER_SAMPLE=200` rows) and returns
`preview_headers_from_frame` — columns + a provisional type guess (`_column_report
(counts=False)`), `n_rows: None`, `rows: []`, `provisional: True` — fast even on
a multi-million-row file. The existing `/import/preview` (full parse) then fills
in n_distinct/n_missing/n_unparsed/levels + preview rows. Both passes share the
byte/frame caches; the sample parse is cached under a separate `sample` key so it
can't collide with the full parse. Frontend: `ImportWizard.runPreview` fetches
headers → paints columns + enabled type dropdowns immediately (stats show "…",
heading shows "computing stats…"), then fetches the full preview to fill stats +
the preview table; a seq guard drops stale responses, a type change skips the
provisional flash (`reparse=false`, types don't affect the parse), and Import is
disabled until the full pass lands. Test: `test_import_headers_first_then_full`.
210 engine tests pass; tsc + vite build clean. NOTE: backend verified via
TestClient and frontend via tsc/build, but not click-tested in a live browser
(no Chromium in this sandbox — same constraint as items 3/13).

## Geom-first workflow

### 23. Allow selecting a geom before selecting data — TODO
It should be possible to pick a geom *before* loading/selecting data. The chosen
geom should then restrict what data can be loaded — i.e. the geom's encoding
requirements (its `(x_type, y_type)` expectations) constrain the columns/types
that are offered or accepted on import, the inverse of item 6 (which filters the
add-layer menu by the current encoding). Effectively: encoding-first and
geom-first should both be valid entry points, each narrowing the other.
