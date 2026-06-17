# TODO

Open items only, ordered by the agreed sequence: a quick contained bug first,
then the validation net before the feature it validates, then remaining feature
work by increasing scope. The two browser-blocked items sit at the end.

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

### C. Rationalize plot-style specification
The style controls are currently split inconsistently:
- Some params live in the Encoding & Layers column, some in the Style tab.
- Some are missing entirely (e.g. boxplot background/fill color).
- Some are shown when not applicable (e.g. jitter shown on a beeswarm plot).
Audit every plot param, give each a single canonical home, add the missing
ones, and gate each param on the geoms it actually applies to.

Spec'd 2026-06-17 → `docs/superpowers/specs/2026-06-17-rationalize-plot-style-design.md`.
Decisions: ONE plot-level Style surface (layer cards keep only geom + level);
per-layer params fold into a geom-keyed section of `style.overrides`, applied per
geom (no per-instance divergence); a single engine-emitted `style_registry`
(served on /health, like the geom registry) becomes the source of truth and
StylePane renders generically from it, killing the 4-way `STYLE_DEFAULTS` /
`StyleOverrides` / StylePane / `param_specs` drift. Each knob tagged
`transferable` to define the style-vs-content seam item F builds on. Missing
knobs to add: box fill + fill_alpha, violin fill_alpha, tile colormap +
show_counts, regression CI-band toggle. Raw-matplotlib escape hatch deferred.

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

### I. Drop click-to-exclude/select on dots; keep exclusion in the DataTable
The right-click-data → exclude interaction is a bad feature, and making *every
dot individually clickable* is what makes it expensive. Investigation
(2026-06-17) found the clickability contract is the root cause of several costs:
- **SVG payload.** A clickable dot must be its own `<use>` node with a stable
  gid + a `point_group` (`gid → row_ids`). This is exactly why `POINT_CAP = 3000`
  exists — `geoms.py:13`: 82,241 pts → a 13.8 MB SVG with 82k `<use>` nodes.
  Without the contract, dots can flatten to a single simplified path and the cap
  could rise sharply or disappear.
- **Render path distortion.** A `<use>` glyph must be reusable, so `_geom_dot`
  (`compiler.py:876`) cannot vectorize per-point colour in one `scatter` call —
  it splits every group into `(marker × colour)` sub-series, each its own scatter
  + gid + point_group (`compiler.py:879`). Dropping the contract collapses
  numeric-colour dots back to one `ax.scatter(c=cvals)`.
- **Frontend wiring.** Every figure injection walks all point_groups and adds 2
  listeners + a `<title>` + a `useByRow` entry per `<use>` (`FigurePane.tsx:120`)
  — ~6k listeners + 3k DOM mutations at the cap — and forces the raw-SVG
  `innerHTML` trust boundary (`FigurePane.tsx:92`) to stay un-sanitizable.

KEY INSIGHT: exclusion and clickable-dots are separable. There are two ways to
exclude a row — clicking a dot, and the `excluded` checkbox column in the
DataTable (`DataTable.tsx:61`) — and they share one engine endpoint
(`/table/{id}/exclude`). The DataTable path needs no point_groups/gids.

PROPOSAL: remove click-to-exclude AND click-to-select from the figure (both ride
the same `point_groups` loop), keep exclusion via the DataTable checkbox. Then
draw dots as flattened paths, raise/remove `POINT_CAP`, vectorize `_geom_dot`
colour, and delete the FigurePane per-`<use>` wiring. The `point_groups` emission
in the compiler can go too. Trade-off: in-figure selection highlighting is lost
(it's wired through the same machinery). Engine `excluded`/`n_excluded` plumbing
(session.py, reduce.py, stats.py, methods-text) stays as-is.

### 1. Facets cannot be plotted — REOPENED (facet ROW) 2026-06-16
Facet COL is fixed and verified; facet ROW still doesn't work in the running app.
Everything verifiable headlessly passes, so the remaining bug is app/browser-side
and not reproducible in this sandbox (no Chromium):
- Engine renders facet row in isolation (`build_comparison_figure`, 2 axes,
  tall figsize, no warnings) and via `POST /analyze` (200, both level labels in
  the SVG), for box/dot/scatter/tile. `tests/test_facets.py` exercises
  `facet_row="site"` across grid-shape, per-cell data, unique gids, scatter and
  tile — all green.
- Frontend wiring is symmetric with facet col (`EncodingsCard` FACET_KEY
  facet_row→facetRow; `state.buildSpec` facet.row = p.facetRow).
Likely candidates to check WITH a browser: (a) the per-cell sizing makes a
facet-row figure very tall (height_mm × n_rows) — it may overflow/clip the
figure pane or render as an unusable sliver, so the *display* (not the data) is
the failure; (b) a console error when the facet-row select changes. NEXT: repro
in the app, capture the console + the produced figure height, and decide whether
to cap total figure size and/or fix the figure-pane display of very tall
figures.

### 2. Phase 3 (Data-First Encodings) e2e coverage — TESTS ADDED, execution pending
Three UI-wiring e2e tests are written (mirroring the verified
`aesthetics_test.mjs` pattern: explicit import via the ImportWizard hidden file
input → switch to Analyses → map X/Y → `.add-layer-btn` flow):
- `e2e/continuous_color_test.mjs` — categorical X + numeric Y + numeric Color on
  a Dots layer draws a colorbar (label = column) and NO discrete legend.
- `e2e/horizontal_test.mjs` — numeric X + categorical Y offers + renders a
  horizontal Box with the categorical levels as y tick labels.
- `e2e/tile_test.mjs` — categorical X × categorical Y offers only the Tile geom
  and renders the contingency figure.
All three pass `node --check`. NOT executed here — this sandbox has no Chromium
and no network to download one. Run on a machine with Chromium: start the engine
(8765) + vite (5173), then `node e2e/continuous_color_test.mjs` (and
`horizontal_test.mjs`, `tile_test.mjs`); each exits 0 on success. Batch with
item 1 whenever a browser environment is available.
