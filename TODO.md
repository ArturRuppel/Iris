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
into the deferred pair_by work.)

## 1. Auto-detect 0/1 columns as bool on import — TODO
When importing data, a column whose non-null values are only `0` and `1` should
be auto-detected as `bool`, and if the user picks/confirms it as `bool` it should
be converted to true/false on import. NOTE: this reverses the deliberate choice
made when the bool type was added, where `_infer_type` intentionally excluded
`0/1` from the bool vocabulary so a real numeric 0/1 *measure* wouldn't be
hijacked. So this can't be a blanket auto-detect — it needs a tie-breaker (e.g.
column-name heuristic, or offer bool as a suggested-but-not-default type for 0/1
columns) so genuine numeric 0/1 measures still import as numeric. The
retype-to-bool path and the 0/1→true/false conversion on commit are the concrete
deliverables.

## 2. Geom-first workflow: allow selecting a geom before data — TODO
It should be possible to pick a geom *before* loading/selecting data. The chosen
geom should then restrict what data can be loaded — i.e. the geom's encoding
requirements (its `(x_type, y_type)` expectations) constrain the columns/types
that are offered or accepted on import, the inverse of the existing add-layer
menu filtering (which filters the add-layer menu by the current encoding).
Effectively: encoding-first and geom-first should both be valid entry points,
each narrowing the other. Larger UX/architecture change — do last of the active
items since it touches the most surface.

## Browser-blocked (no Chromium in this sandbox)

### 3. Facets cannot be plotted — REOPENED (facet ROW) 2026-06-16
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

### 4. Phase 3 (Data-First Encodings) e2e coverage — TESTS ADDED, execution pending
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
item 3 whenever a browser environment is available.
