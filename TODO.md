# TODO

Open items only, ordered by the agreed sequence: a quick contained bug first,
then the validation net before the feature it validates, then remaining feature
work by increasing scope. The browser-verification batch (previously blocked on
no Chromium) was RUN on 2026-06-22 — see its section at the end for what it
found and the two stale tests deferred from it.

(Completed items 1–22, the resolved repetition-key/superplot item, the
"picking X auto-propagates into Color" bug, the validation corpus, and the
multi-comparison + significance-bracket work were removed on 2026-06-17 — see
git history for their write-ups. The validation corpus shipped one case per stat
family in `engine/validation/` with reference values independently recomputed
against raw scipy. Multi-comparison shipped: `stats.group_comparison` now
delegates to `multi_group_comparison` for >2 groups (one-way ANOVA + Tukey, or
Kruskal + Holm-adjusted pairwise), the compiler stacks one significance bracket
per pair, the StatsPanel shows the omnibus + pairwise table, and the deferred
`iris-species-anova` validation case (F=1180.16) was added.

Decisions made while building multi-comparison: default correction is Tukey HSD
for ANOVA / Holm-adjusted Mann-Whitney for Kruskal; all pairs are shown (not
vs-reference); the dense-stack legibility question was answered by ordering
brackets by span and labelling with stars (n.s. brackets are still drawn, not
hidden). Paired multi-group (RM-ANOVA / Friedman) remains out of scope and folds
into the deferred pair_by work.

The 0/1-bool-on-import item shipped 2026-06-17 (see git history): a 0/1 column
stays numeric by default but the importer flags it `suggest_bool` and the
ImportWizard offers a one-click "set to bool" nudge; `_parse_bool` now converts
0/1 -> true/false on retype/commit. The tie-breaker chosen was "suggest, don't
default" so genuine numeric 0/1 measures aren't hijacked.

The geom-first workflow shipped 2026-06-17 (see git history): two pure helpers
in `channels.ts` — `geomAddable` (an unmapped axis no longer blocks a geom, so
a geom can be picked first) and `geomAxisColTypes` (chosen geoms narrow what
X/Y offer, the inverse of the add-menu filter). EncodingsCard and LayerRail are
wired to them; the logic is unit-tested but the end-to-end UX flow still needs a
browser pass — folded into the browser-blocked batch below.)

All active (headlessly-completable) items are done. The remaining items need a
browser (no Chromium in this sandbox) and should be batched together.

## New UX / styling items (added 2026-06-17)

(Item A — analysis-list rename interaction — shipped 2026-06-17. The
always-editable `<input>` in `PlottableSidebar` was replaced with a display
`.plottable-name` span, so left click always selects. Rename now happens via
double-click OR right-click → context menu. Per the chosen design the context
menu carries all three row actions — Rename / Duplicate / Delete — and the
inline ⧉/✕ buttons were removed for a cleaner name-only row. Rename commits on
Enter/blur, cancels on Escape, and ignores empty names. Typechecks + 65 unit
tests green; the visual/interaction pass is folded into the browser-blocked
batch but the logic is headlessly sound.)

(Item B — resizable analysis list — shipped 2026-06-17. Clarified to mean the
Analyses sidebar *width* (the list is a single column of rows). Added a 6px
`.sidebar-resize` drag handle on the panel's right edge; dragging sets the
`<aside>` width (clamped 140–480px) and persists it to `localStorage`
(`plottable-sidebar-width`) so it survives reloads. Long names already ellipsis
+ tooltip after item A; widening now reveals them in full. Typechecks; visual
pass folded into the browser-blocked batch.)

(Item C — Rationalize plot-style specification — shipped (engine + frontend).
Spec'd 2026-06-17 → `docs/superpowers/specs/2026-06-17-rationalize-plot-style-design.md`.
The four hand-synced knob lists collapsed to ONE engine-emitted source of truth:
`engine/iris_engine/style.py` `style_registry_payload()` describes every knob
(key/label/group/widget/default/scope, plus `applies_to_*`/`visible_when` gating
and a `transferable` tag), served on `/health` next to the geom registry
(`main.py:406`). `StylePane.tsx` is now a generic renderer over `styleRegistryAtom`
— the hand-coded fieldsets, the `D` default const, and the `marks.has(...)`
conditionals are gone; figure-scope knobs write `style.<key>`, geom-scope knobs
write `style.geoms.<geom>.<key>`. Per-layer params folded into that geom-keyed
section; the `_param()` precedence fallback was deleted in favour of
`resolve_geom_style` (registry default → `geoms.<geom>` → per-layer `layers.<id>`,
the last tier added by item K). The audited missing knobs were added: box
`fill`/`fill_alpha` via `patch_artist` (`compiler.py`), violin `fill_alpha`, tile
`colormap` + `show_counts`, regression/trend `show_band`. The `transferable`
partition defined here is what item F consumes. Raw-matplotlib escape hatch and
per-layer-instance divergence were deferred (the latter later un-deferred by K).
302+ engine + 86 FE tests green.)

(Item F — Loadable / applicable style sheets — shipped. A style sheet is C's
`transferable` slice of `style.overrides` (`src/style/sheet.ts`: `captureStyle`
drops content keys — titles/labels/ranges/offsets — keeping look + palette-by-index
+ geom looks). Three persistence tiers exist: in-session clipboard
(`styleClipboardAtom`), named localStorage library (`styleLibraryAtom`), and
export/import `.iris-style` JSON v1.0 (`serializeStyleSheet`/`parseStyleSheet`,
Export/Import buttons in StylePane). Copy/Paste style live on the analysis
right-click menu (`PlottableSidebar.tsx`, `pasteStyleAtom`). `sheet.test.ts`
covers the transferable round-trip. NOT browser-verified here — the apply-to-
multi-selection UX folds into the browser-blocked batch.)

(Item D — superseded 2026-06-17. The user redirected: rather than relocate a
multi-option size picker, collapse to a single canonical default size and rip
the preset concept out entirely. Done: the top-row "Size" select is gone;
engine `STYLE_PRESETS` (demo_default / nature_single / nature_double) was deleted
and its demo dims (140×100 mm, font 9 pt) folded into `STYLE_DEFAULTS`;
`resolve_style` no longer reads `style.preset` (any value on old saved .iris is
ignored, so they still load); `preset` removed from `PlottableState`, `makeDefault`,
`fromSpec`, `buildSpec`, the `AnalysisSpec` wire type, and the state-test fixture.
Per-plot width/height overrides in the Style pane remain the only size control
(placeholders now read 140/100). Engine tests that asserted the Nature dims
(`test_engine.py`, `smoke_frozen.py`) were switched to width_mm/height_mm
overrides. 65 FE + 286 engine tests green, typecheck clean.)

(Item E — reframed + shipped (engine + wiring) 2026-06-17. The original "drag
the legend out and auto-grow the canvas" was reframed by the user to avoid
drop-zone magic: instead, the canvas and the plot area become two independent
draggables. The canvas is already resizable (the existing corner handle sets
width_mm/height_mm); the NEW piece is a draggable/resizable PLOT AREA (the axes)
within it. "Docking" the legend now falls out: grow the canvas, pull the plot
area aside to free a strip, and drag the (already-draggable) legend into it —
no longer clipped because the canvas is bigger.

Engine: new `axes_rect` override = [left, bottom, width, height] in figure
fractions; `_decorate` tags the axes background `<g id="plot-area">` (unfaceted
only) so the frontend can locate it, and stashes the rect; `_apply_axes_rect`
runs inside `_finalize_deferred` (after constrained layout solves + legend
re-anchor, before the layout engine is frozen) and pins it via
`ax.set_position`. Idempotent on a second save. `tests/test_axes_rect.py`
(3 cases: pins the rect, opt-in, idempotent) + full suite = 289 green.

Frontend: `FigurePane` reads `#plot-area`'s client rect and overlays a move grip
(top-left) + resize grip (bottom-right); dragging commits `axes_rect` (figure
fractions, y-flip handled). `StyleOverrides.axes_rect` typed; flows through the
existing style passthrough. 65 FE tests + build green, typecheck clean.

NEEDS A BROWSER PASS (no Chromium here): the actual drag feel, grip placement vs
the canvas handle, and the legend-into-freed-strip workflow are unverified
visually — fold into the browser-blocked batch. Engine layout + state wiring are
headlessly proven.)

### F. Loadable / applicable style sheets
It would be nice to be able to load and apply style sheets so that propagating a
style is easy: once the user has tweaked one plot's styling, they can apply that
same style to another plot in the same file or in another file. Capture a plot's
style as a reusable sheet, then apply it to other plots.

Spec'd 2026-06-17 → `docs/superpowers/specs/2026-06-17-style-sheets-design.md`.
Depends on C: a style sheet IS C's `transferable` slice of `style.overrides`
(look, not content — drops titles/labels/ranges/offsets). One `applyStyleSheet`
merge (geom sections by name, palette by index) serves all three sources.
Decisions: whole-sheet apply (no per-group opt-out) but selectable targets;
right-click an analysis → Copy style / Paste style; paste hits the analysis
multi-selection (sidebar gains Cmd/Shift-click multi-select). Three persistence
tiers — in-session clipboard atom, named localStorage library
(`iris.styleLibrary`, mirrors `iris.typeColors`), and export/import `.iris-style`
JSON (v1.0, separate from the frozen `.iris` doc). Open Qs: import→clipboard vs
library, an "apply to all" shortcut, global vs per-table library.

(Item G — shipped 2026-06-17. The plot's `n=` annotation reported only the
innermost (raw replicate) count; now it reports every grain the LAYERS actually
draw at (decision: "only the drawn levels"), finest→coarsest. `_draw_n_labels`
takes one count-map per drawn grain; `_n_label` formats them: one grain →
`n = R` (unchanged for plain plots), two → `n = R  N = U` (replicates + units,
the superplot pair), more → indexed `n₀ = …  n₁ = …` (unicode subscripts).
In `build_comparison_figure` the distinct `layer.level`s are collected (unknown
levels collapse to RAW) and ordered by level-table size (a finer grain has more
rows — no dependence on `spec.hierarchy`); per-grain per-x-level counts come from
each level table filtered to the facet cell. Engine-only, headlessly verified:
`tests/test_n_labels.py` (5 cases — label formatting for 1/2/3 grains, plain plot
shows only `n=`, superplot shows `n = 6  N = 2`). 294 engine + 65 FE green.
NB: this is the figure annotation; the StatsPanel's own n (test/unit n) is
separate and untouched.)

### H. Pan / zoom / home interaction in the figure pane (investigate first)
It would be nice to pan and zoom within a plot and reset with a "home" button,
like Plotly. INVESTIGATE COMPLEXITY FIRST before committing: the engine renders
static SVG via matplotlib, so this is not free — options to weigh are (a) a
client-side pan/zoom of the SVG viewBox (cheap, but axes ticks/labels won't
re-flow), (b) re-rendering on the engine per view change (accurate, but a round
trip per gesture), or (c) swapping the figure pane to an interactive renderer.
Scope the trade-offs before building.

(Item I — shipped 2026-06-17. Click-to-exclude AND click-to-select were removed
from the figure; exclusion stays via the DataTable `excluded` checkbox (the
shared `/table/{id}/exclude` endpoint is untouched). Decision on the cap (asked):
stay fully VECTOR and raise the cap modestly rather than rasterize — a vectorized
scatter is still one `<use>` per point (~150 B), so rasterizing was the only way
to *remove* the cap, and the user chose to keep crisp vector dots. `POINT_CAP`
3000 → 10000 (`geoms.py`), justified by dropping the ~6k per-point frontend
listeners, not by node count.

Engine: the `point_groups`/`gid → row_ids` contract is gone end-to-end.
`_geom_dot` and `_draw_points` no longer emit gids/point_groups and now vectorize
colour — a discrete colour passes a per-point RGBA array in ONE `ax.scatter`
(numeric colour was already `c=cvals`); only a mapped *shape* still splits (one
scatter per marker, a matplotlib limitation). `build_*_figure`/`build_figure`
return just `fig`; the `_run`/`/analyze` payload is `figure: { svg }` (no
`point_groups` field). `_group` dropped its `point_ids` chaining; `_layout`
dropped `gid_start`. The hierarchy `row_ids` column stays as unit→raw provenance
(its own test/data-model concern), just no longer read by the compiler.

Frontend: FigurePane lost the per-`<use>` loop (2 listeners + `<title>` +
`useByRow` per point), the selection-highlight effect, the right-click exclude
context menu, and `selectedRowIdAtom` (deleted from state). `estimateBytes`
simplified to `svg.length + overhead` (no per-row-id term). `types.ts`
`AnalyzeResponse.figure` is now `{ svg }`; `PointRowIds` removed. `.pt-selected`
CSS dropped (the shared `.context-menu`/`.menu-backdrop` stay — used by the
sidebar + style popover). The raw-SVG `innerHTML` trust boundary remains (still
our own localhost matplotlib output) but no longer needs the gid structure.

Tests: the validation SvgFacts parser now counts marks from matplotlib's own
`<g id="PathCollection_N">` groups instead of `pts-N` (one `<use>` per point);
all per-point-contract assertions across test_engine/aesthetics/hierarchy/
horizontal/facets/beeswarm/tile/timeseries/smoke were rewritten to assert the
vectorized collection structure (e.g. a discrete colour = one collection with a
per-point facecolor array). 294 engine + 65 FE tests green, typecheck + build
clean. NOT browser-verified here (no Chromium): the e2e `superplot_test.mjs`
assertion was updated to the new `PathCollection_N` structure for whoever next
runs it with a browser — fold into the browser-blocked batch.)

## Browser-verification batch — RAN 2026-06-22

Ran the whole `e2e/` suite + facet-row repro on a machine with a real browser
(Playwright Chromium 1223). The batch cleared, and it surfaced one genuine
engine bug — write-ups below. Net: **11/11 e2e pass.** The run first found 9/11,
with two stale tests (superplot, timeseries) needing UI-selector/flow rewrites,
not app bugs; both were rewritten and are now green (see "Deferred stale tests"
below — kept under that heading for the write-up of what drifted).

(Item 1 — Facet ROW — RESOLVED 2026-06-22. Reproduced in the running app:
facet row now renders both panels (`site = north` / `site = south`) as a normal
tall 140×200 mm two-row figure that scrolls in the figure pane — NOT a clipped
sliver, no console error. The SVG fits within the pane (no overflow). The data
path was already green via `tests/test_facets.py`; this confirms the *display*
the earlier note worried about. `e2e/facets_test.mjs` (which maps Facet Row →
site and asserts a 2-axes grid) passes.)

(Item 2 — Phase 3 e2e coverage — EXECUTED + RESOLVED 2026-06-22. All three
(`continuous_color_test`, `horizontal_test`, `tile_test`) now pass. They were
RED on first run, but the cause was the svg.fonttype bug below — once the engine
emitted real `<text>` again, the colorbar/tick/level-label assertions matched.
No test-logic change was needed for these three.)

### REAL BUG FOUND + FIXED 2026-06-22 — SVG/PDF text was outlined to paths
`compiler.figure_to_svg`/`figure_to_bytes` called `fig.savefig(...)` OUTSIDE any
`rc_context`. `svg.fonttype`/`pdf.fonttype` are read at *savefig* time, not
figure-build time, so the `_rc(style)` context (which set `svg.fonttype: none`)
had already exited — and the global default `path` won. Every figure shipped
with all text OUTLINED to vector glyphs (`<use>` glyph refs + a `<!-- label -->`
comment), silently breaking the documented "real text in SVG (editable,
selectable)" promise and bloating output. Fix: hoisted the two output-time font
params into a module-level `_OUTPUT_RC` and wrapped both savefig calls in
`plt.rc_context(_OUTPUT_RC)`. Verified: figures now emit real `<text>` nodes.

This had also quietly shaped the TEST suite: `validation/svgstruct.py` and the
per-test helpers in `test_engine`/`test_tile`/`test_multigroup`/`test_horizontal`
/`test_aesthetics` parsed label text out of matplotlib's `<!-- … -->` comments
(a `path`-mode artifact) and even *mislabelled* that as "svg.fonttype=none"
behaviour — i.e. the whole harness was validating against the bug. Migrated all
of them to read real `<text>` content (svgstruct gained `_texts`/`_first_text`;
the legend-position probe reads the title `<text>`'s x/y instead of a
`translate`). 302 engine + 86 FE tests green after the migration.

### Deferred stale tests (2 e2e) — RESOLVED 2026-06-22 (both rewritten, green)
Both failed only on UI selectors/flows that drifted since they were written
(2026-06-16/17); neither was an app bug. Both rewritten against the current UI;
full e2e suite now 11/11.
- `e2e/superplot_test.mjs` — the old test built the spine by clicking chips in a
  `.hierarchy-card` inside the Analyses tab. That model is gone: the spine is now
  *auto-seeded on import* from the identifier columns (`subject`/`rep` are
  `_ID_TOKENS`) and the hierarchy panel (`.hierarchy-panel`) lives in the **Data**
  tab. Rewritten to: assert the 2-level spine in the Data tab, then compose the
  canonical box(raw) + dot(subject) superplot (the add menu excludes already-used
  geoms, so the classic same-geom dot+dot superplot is NOT menu-buildable — minor
  UI limitation, noted). The `.pairing-badge` assertion was dropped: the pairing
  verdict is engine-only (`model.pairing`, consumed by StatsPanel solely to gate
  paired-test offering) and is NOT rendered anywhere — the earlier note's "moved
  into the Inferred model section" was aspirational. Replaced with the genuinely
  user-visible payoff of the spine: binding the prominent layer to `subject` moves
  the inferential grain there, so the per-group summary counts subjects (n = 3),
  not raw rows (n = 9). That assertion exercises the whole spine→inference path.
- `e2e/timeseries_test.mjs` — `frame` is an `_ID_TOKENS` identifier, excluded from
  axes by design. Rewritten to retype `frame` identifier→numeric in the import
  wizard (locate its `.wizard-col`, set the type select to `numeric`, wait for the
  commit button to re-enable) before mapping it to X — the real time-on-X
  workflow. See the product note (still open) for the underlying friction.

Two minor findings surfaced, both flagged not fixed (neither blocks the suite):
- The pairing verdict is computed but never surfaced in the UI. If it should be
  shown, the home is StatsPanel's "Inferred model" section (it already reads
  `model.pairing` there). Small, honest addition; left out to keep this test-only.
- The add-layer menu hides already-used geoms, so the classic same-geom superplot
  (small raw dots + big subject dots) can't be built from the menu — only mixed
  geoms (box+dot). Revisit if the same-geom idiom is wanted in-app.

### PRODUCT NOTE (flag only, no change made) — identifier default vs time-on-X
A column named `frame`/`time`/`timepoint` defaults to `type: identifier` and is
therefore NOT axis-mappable without a manual retype — which is friction for the
core time-lapse-microscopy use case (time on X is the whole point of the
time-series geom family). Decision 2026-06-22: leave the identifier detection as
is for now and just record this. If revisited, the fix is to let `time`-like
tokens stay numeric/axis-mappable by default (or offer a one-click "use as axis"
nudge like the 0/1→bool one), without losing their role as a nesting level.

## New issues (added 2026-06-22)

### L. Scrutinize .iris save / load + style-param text input
Two distinct problems to work through:
- (**Save/load audit — shipped 2026-06-22.** Root cause of "works only once": there
  was NO "current file" concept at all. `doSave` shipped the engine's base64 doc to
  `downloadBase64` (`types.ts`), an `<a download="document.iris">` data-URI click —
  every save dumped a *new* `document.iris`/`document (1).iris` into Downloads, so
  "write back to the same file" was impossible. A second, latent failure: `doSave`
  had no try/catch (unlike `doLoad`), so an engine error was swallowed and the user
  saw nothing. Fix is three parts. (1) Real OS file handles via the File System
  Access API (Chromium-only, by decision — no users yet, e2e is Chromium): `doSave`
  reuses a retained `FileSystemFileHandle` and `createWritable()`s back to it,
  `doSaveAs` always re-prompts, and `Load .iris` now uses `showOpenFilePicker` and
  retains the handle so a later Save writes back to the opened file. New `Save As…`
  button; the hidden `<input type=file>` is gone. The handle is tagged with the
  table id it belongs to, so after loading A.iris then importing fresh data, Save
  prompts for a new file instead of silently overwriting A.iris. AbortError (picker
  cancel) is a no-op; any other error now surfaces in the error bar. (2) New
  `base64ToBytes` helper + `src/fsaccess.d.ts` for the picker types lib.dom lacks at
  TS 5.9. (3) The real engine bug behind the 409-on-resave the frontend can't
  recover (it holds only a 200-row window, never the full table): `SessionStore` was
  documented as LRU but `get()` never refreshed recency — eviction was FIFO by
  creation, so the *main* table (created first, touched by every analyze/save) was
  the first evicted after 8 derived-table creates. `get()` now moves the id to the
  most-recently-used end, so the actively-used table survives. `test_session.py`
  gains the active-survives + cold-still-evicts pair. 311 engine + 86 FE green,
  typecheck + build clean. BROWSER-VERIFIED (Chromium 1223): new
  `e2e/save_load_test.mjs` stubs the native File System Access pickers with
  in-memory handles (Playwright can't drive OS dialogs) and drives the real
  doSave/doSaveAs/doLoad — asserts a SECOND Save writes again (the once-only
  regression), the bytes are a valid .iris ZIP, Save As writes, and a FRESH page
  loads the saved doc back (full `/document/load` round trip, plottable restored).
  Full e2e suite now 12/12.)
- (**Style params text-field input — shipped 2026-06-22.** Each registry range
  knob in `StylePane` now renders a slider PAIRED with an editable numeric field
  via a new `RangeField` component, replacing the old read-only value span. The
  field keeps a local text buffer while focused so partial input ("0.0…") isn't
  clobbered by clamping; it commits a clamped value on each valid keystroke (same
  cadence as a slider drag) and an empty field clears the override → default.
  Reuses the existing `.narrow` numeric-input CSS, no new styles. Typecheck +
  build + 86 FE tests green. Engine untouched. The non-range widgets — `number`
  (free `auto` fields), `select`, `bool`, `text`, `swatch` — were already typed
  inputs, so this closes the bullet.)

(Item M — Show every nesting level in the n/N annotation — shipped 2026-06-22.
The decision left open in G ("only the drawn levels" vs every spine level) was
NOT settled in the engine — it was handed to the USER as a checkbox. New
annotation knob `show_all_levels` ("Count every nesting level", default OFF,
`visible_when` show_n is on) in the style registry; it renders generically in
StylePane's Annotations section (no FE code change beyond the `StyleOverrides`
type). When ON, `build_comparison_figure` collects grains from ALL
`level_tables` keys (the full materialized hierarchy spine — RAW + every spine
level) instead of just the distinct drawn `layer.level`s; the existing
finest→coarsest size sort and `_n_label` formatting (n / n,N / indexed n₀… for
≥3) carry it. So a box drawn only at RAW shows `n = 6` by default but
`n = 6  N = 2` with the toggle — the undrawn `subject` grain now appears.
`transferable: true` (it's an annotation preference). Engine-only behaviour +
one bool knob; `test_n_labels.py::test_show_all_levels_toggle_surfaces_undrawn_grains`
asserts the off/on contrast. 309 engine + 86 FE green, typecheck + build clean.)

### Shared-metric / repeated-geoms (spec'd 2026-06-22)

Both spec'd 2026-06-22 → `docs/superpowers/specs/2026-06-22-shared-metric-and-repeated-geoms-design.md`
(repro/diagnosis notes, the merged-legend approach for J, and the per-instance-style
reconciliation with item C for K).

(Item J — shipped 2026-06-22. Diagnosis confirmed the spec's hunch: there was
NO literal block — `EncodingsCard` only cross-excludes the X/Y pair, `buildSpec`
passes channels straight through, and `_geom_dot` already drew color+shape on one
column. The symptom was a redundant legend: `Scales.legend_entries()` emitted one
block per channel, so the same column on Color and Shape produced two blocks with
identical labels (`a, b, a, b`, no title). Fix is engine-only: `legend_entries()`
now detects `color_col == shape_col` (categorical color only — a numeric color is
a colorbar and can't fuse) and emits ONE `channel: "color+shape"` block whose each
swatch carries both `color` and `marker`; `_draw_legend` builds a combined handle
(`Line2D` with both `markerfacecolor` and `marker`). Result: one titled block,
one row per label. Tests: `test_scales.py` (merge + the numeric-color-no-merge
guard), `test_aesthetics.py` (render-level — one block, both attributes on each
handle). 307 engine + 86 FE green. No UI change needed.)

(Item K — shipped 2026-06-22 (engine + state + StylePane). The data model already
supported repeats (`Layer` has a client-stable `id`, `addLayerAtom` mints a fresh
one); the only block was a UI uniqueness assumption in `LayerRail` — `used`/`notUsed`
excluded already-added geoms from the add menu and retype list. Removed: any
type-compatible geom can now be added again, and re-typed to a geom already in the
stack. The reconciliation with item C (geom-keyed `style.overrides.geoms`, one
section per geom) was the real work: added a THIRD style tier keyed by layer id —
`resolve_geom_style(style, geom, layer_id)` now merges registry default →
`geoms.<geom>` (shared by every instance) → `layers.<id>` (this instance),
most-specific winning. All per-layer comparison/timeseries geom calls (`dot`, `box`,
`violin`, `bar`, `summary`, `line`, `trend`) pass `layer.get("id")`; figure-level
geoms (scatter/distribution/tile) stay on the geom tier (they don't repeat per
layer). `StyleOverrides.layers` typed and flows through buildSpec/fromSpec and the
`.iris` round-trip unchanged (layer ids are serialized in `spec.layers`, so the
keys stay matched on reload; not transferable, so style sheets drop them via the
existing `captureStyle`). StylePane: a singly-used geom edits the shared
`geoms.<geom>` tier as before ("<geom> options"); a repeated geom shows one
fieldset PER layer instance, each editing its own `layers.<id>` and labelled by its
data level ("dot · Raw (every row)" / "dot · per cell") so the superplot's faint
small dots + bold big aggregate dots are built directly. Tests: engine 3-tier
resolution + a two-dot-layer render asserting both marker sizes draw; 307 engine +
86 FE green, typecheck + build clean. NOT browser-verified here (no Chromium): the
StylePane per-instance fieldsets and the repeated-geom add-menu UX fold into the
browser-blocked batch.)
