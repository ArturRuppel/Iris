# Rationalize plot-style specification — Implementation Plan

**Date:** 2026-06-18
**Spec:** `docs/superpowers/specs/2026-06-17-rationalize-plot-style-design.md`

## Engine

- [x] 1. **Create `engine/iris_engine/style.py`** — the declarative style registry.
  Every knob declared once: key, label, group, widget (type + bounds/options),
  default, scope (figure | geom), `applies_to_geoms`, `visible_when`,
  `transferable`. `STYLE_DEFAULTS` and `GEOM_STYLE_DEFAULTS` derived from the
  registry at import time. `_DRAG_ONLY` (offsets, axes_rect) tracked but not
  in the payload.

- [x] 2. **`resolve_style()` + `resolve_geom_style()`** in `style.py`.
  `resolve_style` merges flat overrides onto `STYLE_DEFAULTS`, stashes
  `overrides.geoms` for geom resolution. `resolve_geom_style(style, geom)`
  merges `overrides.geoms[geom]` onto that geom's registry defaults.

- [x] 3. **Update `compiler.py`** — import from `style.py`, delete inline
  `STYLE_DEFAULTS` + `resolve_style` + `_param()`. Every geom renderer reads
  its knobs from `resolve_geom_style` instead of `_param`. `_layer_param`
  (timeseries) replaced likewise.

- [ ] 4. **Add missing knobs** (wired into the renderers):
  - Box fill + fill_alpha → `_geom_box` gains `patch_artist=True` + facecolor
  - Violin fill_alpha → `_geom_violin` reads from geom style
  - Tile colormap → `build_tile_figure` reads `colormap` from geom style
  - Tile show_counts → `build_tile_figure` reads `show_counts`
  - Regression show_band → `build_scatter_figure` reads `show_band`

- [x] 5. **Serve style registry on `/health`** — `style_registry_payload()`
  added to the `/health` response alongside `registry_payload()`.

- [x] 6. **Remove duplicate keys from `STYLE_DEFAULTS`** — marker_size,
  marker_alpha, layout, jitter, mark_width, error_type, capsize, notch,
  outlier_marker, outlier_size, hist_bins. Already done: STYLE_DEFAULTS is
  now derived from the registry which only puts figure-scope entries in the
  flat dict.

- [x] 7. **Strip `param_specs` from geoms.py `GEOMS`** — the per-geom style
  knobs now live in the style registry; `param_specs` on `GeomDef` become
  empty (kept for `level` which stays on the layer card). Remove per-geom
  `params` defaults that moved to the registry. Update `registry_payload()`.

## Frontend

- [x] 8. **Update `StyleOverrides` type** in `types.ts` — remove dup flat
  keys (marker_size, marker_alpha, layout, jitter, mark_width, error_type,
  capsize, notch, outlier_marker, outlier_size, hist_bins), add `geoms?`
  sub-object typed per geom. Also: removed `ParamSpec`, added `StyleKnob` +
  `StyleKnobWidget`, removed `params`/`param_specs` from `GeomMeta`.

- [x] 9. **Rewrite `StylePane.tsx`** as a generic registry renderer — reads
  `styleRegistryAtom`, groups entries by `group`, gates geom groups by
  active layers, gates entries by `visible_when`, renders each widget type
  generically. Deleted hand-coded fieldsets, the `D` const, and the
  `marks.has(...)` conditionals. Color swatch popover preserved.

- [x] 10. **Strip style param editors from `LayerCards.tsx`** — keeps `geom` +
  `level` only; the style knobs that were per-layer params now live in
  `StylePane` under the geom's section.

- [x] 11. **Update `buildSpec` / `plottableFromSpec`** in `state.ts` — added
  `migrateLayerParams()` to hoist layer params → `style.overrides.geoms`,
  `addLayerAtom` + `duplicatePlottableAtom` no longer touch params.
  `styleRegistryAtom` added and populated from `/health`.

## Normalization

- [x] 11b. **`specnorm._migrate_layer_params`** — hoists layer `params` into
  `style.overrides.geoms.<geom>` during normalization, called for both
  legacy and 2.0 paths after dist-layer migration. Params are stripped from
  layers.

## Tests

- [ ] 12. **Engine tests** — registry completeness (every geom param has a
  registry entry; every entry's `applies_to` is satisfiable), render test
  per new knob (box fill, violin alpha, tile cmap, tile show_counts,
  regression band), transferable partition round-trip.

- [x] 13. **Run full engine + frontend test suites** — 288 engine tests and
  65 FE tests green; typecheck + build clean. Specnorm tests updated to
  assert against `style.overrides.geoms` instead of `layer.params`.
