# TODO

Ordered easy → hard.

## Bugs & UX issues reported 2026-06-16

### 1. Color palette clips in fullscreen
Opening the color palette in the styling tab works, but the palette popover gets
clipped when the browser is in fullscreen. Fix the popover positioning/overflow.

### 2. Empty start page
On a fresh start the page is just blank. It should instead show an empty table
layout for entering data manually, or at minimum a prompt like "Import or enter
data to start."

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

### 4. Color mismatch between styling tab and plot
Colors render in a different color than what's shown in the styling tab. The
plotted color should match the selected color.

### 5. Live preview vs final render mismatch on resize
When resizing plots, the live preview doesn't match the final render. The
preview keeps the aspect ratio constant, but the final resize does not. Make the
preview reflect the actual resize behavior.

### 6. Add-layer menu should filter by encoding compatibility
When adding a new layer, only layers that are compatible with the selected
encoding should be offered.

### 7. Auto scale picker too sensitive to outliers
The automatic scale picker is too sensitive to outliers. For plots that display
the outliers (e.g. scatter), this is correct. But for plots where outliers
aren't shown (e.g. bar plots), the range should be defined by what's actually
drawn on the plot.

### 8. Analysis / Pipeline / Encoding bars: unify style + collapsible
The Analysis, Pipeline, and Encoding bars should match in style and all be
collapsible. Use the Pipeline bar as the template for the others.

### 9. Shape/size encoding broken in dot plots
Encoding categorical or numerical data as shape or size doesn't work in dot
plots.

### 10. Define the independent-repetition key (n for stats)
It should be possible to choose which key (or combination of keys) represents an
independent repetition. This defines `n` for the various calculations and
statistical tests.

### 11. Stale plots when data/stats should be removed
Changing something in the config invalidates the current plot, but the new plot
can't be rendered and the stale one sticks around. Symptom: a config change
happens, but the render either keeps showing the old figure or fails silently
instead of producing the updated plot. Need to trace the render-invalidation
path — figure out why a config change that should drop the old data/stats and
recompute doesn't successfully re-render.

### 12. Facets cannot be plotted
Plotting facets currently errors. Console shows engine warnings:
- `compiler.py:175` — "Attempting to set identical low and high ylims makes
  transformation singular; automatically expanding." (in the
  `style["y_min"]`/`style["y_max"]` branch)
- `compiler.py:807` — "constrained_layout not applied because axes sizes
  collapsed to zero" (repeated, at the per-facet `ax = axes[ri][ci]` access)
The facet axes are collapsing to zero size. Investigate the facet grid sizing /
figure layout in the compiler.

## No Phase 3 (Data-First Encodings) e2e coverage

### 13. No Phase 3 e2e coverage

Phase 2 (Aesthetics) got `aesthetics_test.mjs`; Phase 3's three new render
paths — continuous color (numeric color → colorbar), horizontal orientation
(numeric x + categorical y), and the contingency tile (categorical x ×
categorical y) — only have engine/unit tests
(`engine/tests/test_aesthetics.py`, `test_horizontal.py`, `test_tile.py`,
`src/channels.test.ts`), no UI wiring test. Worth adding once the existing
suite (above) is fixed, since `111243b`'s `TEST_BY_FAMILY` contingency-key
crash shows this class of bug only surfaces through the UI.
