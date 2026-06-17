# Rationalize plot-style specification

**Date:** 2026-06-17
**Status:** Draft
**TODO item:** C (New UX / styling items)

## Problem

Style knobs are split across two systems that overlap, leak, and gate
inconsistently:

- **Plot-level style** — the `StyleOverrides` TS type → `spec.style.overrides`
  → engine `STYLE_DEFAULTS`, edited in `StylePane.tsx`. Font, frame, ticks,
  palette, ranges, size, plus a grab-bag of mark options (`notch`, `mark_width`,
  `error_type`, `capsize`, `outlier_*`).
- **Per-layer params** — declared in `geoms.py` `param_specs`, stored on
  `Layer.params`, edited in the layer cards (`LayerCards.tsx`). A dot layer's
  `layout`/`jitter`/`marker_size`/`alpha`, a box's `mark_width`, summary/bar's
  `error_type`, distribution's binning, etc.

Three concrete failures (the TODO bullets):

1. **The same knob lives in both places.** `marker_size`, `marker_alpha`
   (= layer `alpha`), `jitter`, `layout`, `mark_width`, `error_type`, `capsize`
   each exist as *both* a `StyleOverrides` key and a geom param. The compiler
   papers over the conflict with `_param()` (layer wins, falls back to style) —
   a precedence rule no user can see or predict.
2. **Knobs are missing.** `_geom_box` draws an **unfilled** box (no
   `patch_artist`/facecolor) — there is no box fill control at all. Violin fill
   alpha is hardcoded at `0.22`. Tile colormap is hardcoded `"Blues"`.
3. **Knobs show when inapplicable.** `StylePane` shows **Jitter** whenever the
   family is grouped, even on a beeswarm (`layout: "swarm"`), where jitter does
   nothing. `hist_bins` is a plot-level key but only the distribution geom reads
   it.

Underneath all three: there is **no single source of truth** for "what knobs
exist." The knowledge is smeared across four places that must be kept in sync by
hand — `STYLE_DEFAULTS` (engine defaults), the `StyleOverrides` interface (TS
types), `StylePane`'s hand-coded `<fieldset>`s + the `D` default const + the
`marks.has(...)` gating conditionals, and `geoms.py` `param_specs`. Every new
knob touches all four; drift between them is the root cause of 1–3.

### What this is *not*

We considered surfacing matplotlib's full API — mapping the UI straight onto
mpl params. **Rejected as the primary model.** matplotlib has no single
enumerable API to mirror (params are spread across rcParams, Artist properties,
and per-method kwargs that differ by artist); a raw passthrough breaks the
contracts the compiler depends on (gids for draggable labels, drag `offsets`,
beeswarm post-processing, significance brackets); it dissolves the `{}` =
house-style contract that makes Iris plots publication-ready by default; and
many Iris knobs are *semantic*, not mpl params at all (`error_type: ci95|sem|sd`,
palette-in-level-order, `show_significance`, `bin_method: sinh`). The curation is
the product (see [[digital-cell-book]]: the target user knows their biology, not
matplotlib). A raw escape hatch is **deferred** (see Out of scope).

## Decision summary

- **One style surface.** Everything moves to the plot-level `StylePane`. The
  layer cards keep only the structural choices — `geom` and `level` — and lose
  their style param editors. Geom-specific knobs *appear inside the Style pane*
  when a layer using that geom is present. Rationale: keep all of a plot's
  styling in one object so it can be exported and re-applied wholesale (item F).
- **Geom-keyed, not layer-instance-keyed.** Per-layer params fold into a
  geom-keyed section of `style.overrides` (e.g. `overrides.geoms.box.fill`),
  applied to every layer of that geom. The cost: two box layers can no longer
  carry different widths. Accepted — it is what makes a style portable across
  plots with different data and different layers, and the common case is one
  layer per geom. Since Iris has no users and no legacy ([[no-legacy-no-users]]),
  we restructure `Layer.params` → `style.overrides` outright and delete the
  `_param()` fallback; no migration.
- **One declarative registry is the source of truth.** The engine emits a
  `style_registry` (alongside `registry_payload()`, served on `/health`)
  describing every knob: `key`, `label`, `group`, `widget` (type + bounds /
  options), `default`, `scope`, gating (`applies_to_geoms` / `applies_to_family`
  / `visible_when`). `StylePane` renders generically from it — exactly as
  `LayerCards` already renders geom `param_specs`. The four hand-synced lists
  collapse to one. `STYLE_DEFAULTS` becomes the registry's default column.
- **Style vs content seam (the C↔F handoff).** Each knob is tagged
  `transferable: true|false`. Transferable knobs travel in an exported style
  sheet; content knobs (title, labels, axis ranges, drag offsets) stay with the
  plot. This partition is defined here so item F can consume it directly.
- **Fix gating at the knob level.** `visible_when` expresses cross-knob
  conditions (jitter visible only when `dot.layout == "jitter"`); `applies_to_*`
  expresses geom/family gating. No more hand-coded `marks.has(...)`.
- **Add the missing knobs** enumerated below — no more, no less. We close the
  audited gaps; we do not open the matplotlib firehose.

## The audit

Every knob, its canonical home, what it applies to, and its disposition. "Scope"
is the section it renders in. "Transfer" = carried by an exported style sheet
(item F).

### Figure — always shown · transferable

| Knob | Was | Widget | Default | Notes |
|---|---|---|---|---|
| `width_mm` | style | number (mm) | 140 | also set by drag / size preset (item D) |
| `height_mm` | style | number (mm) | 100 | " |
| `font_pt` | style | number (pt) | 9 | drives every text size via `_rc` |
| `axis_linewidth` | style | range | 0.8 | spines + ticks |
| `frame` | style | select open/closed | open | |
| `grid_x` | style | bool | family-dep | |
| `grid_y` | style | bool | true | |
| `palette` | style | swatch list | PALETTE | carried **by index** (level names differ across data) |

### Axes & ticks — always shown · look transferable, ranges are content

| Knob | Was | Widget | Default | Transfer | Notes |
|---|---|---|---|---|---|
| `tick_direction` | style | select | out | ✅ | |
| `tick_length` | style | range | 3.5 | ✅ | |
| `x_tick_side` / `y_tick_side` | style | select | bottom/left | ✅ | |
| `minor_ticks` | style | bool | false | ✅ | |
| `x_tick_rotation` | style | number ° | 0 | ✅ | |
| `y_scale` | style | select lin/log | linear | ✅ | |
| `x_scale` | style | select lin/log | linear | ✅ | x-numeric only |
| `x/y_tick_spacing` | style | number | auto | ❌ | data-range dependent |
| `x/y_min`, `x/y_max` | style | number | auto | ❌ | data-range dependent |

### Text — always shown · content (never transferred)

| Knob | Was | Widget | Default |
|---|---|---|---|
| `title` | style | text | "" |
| `x_label` / `y_label` | style | text | auto |
| `offsets` | drag | (drag only) | {} |

### Annotations — gated by family · transferable

| Knob | Was | Gate | Default |
|---|---|---|---|
| `show_n` | style | grouped | true |
| `show_significance` | style | grouped | true |
| `show_annotation` | style | correlation/descriptive | true |
| `show_legend` | engine | a channel needs a legend | auto |

### Geom-scoped — shown iff a layer with that geom is present · transferable

| Geom | Knob | Was | Disposition |
|---|---|---|---|
| dot | `marker_size` | **both** | collapse → geom scope (drop style dup) |
| dot | `alpha` | **both** (style `marker_alpha`) | collapse → geom scope |
| dot | `layout` | **both** | collapse → geom scope |
| dot | `jitter` | **both** | collapse → geom scope; `visible_when layout==jitter` (fixes bullet 3) |
| scatter | `marker_size`, `alpha` | both | collapse → geom scope |
| box | `mark_width` | **both** | collapse → geom scope |
| box | `notch` | style | → geom scope |
| box | `outlier_marker`, `outlier_size` | style | → geom scope; size `visible_when marker!=none` |
| box | `fill`, `fill_alpha` | **MISSING** | **add** — `patch_artist` + facecolor (bullet 2) |
| violin | `mark_width` | both | collapse → geom scope |
| violin | `fill_alpha` | **hardcoded 0.22** | **add** control |
| bar | `mark_width` | both | → geom scope |
| bar | `error_type`, `capsize` | **both** | collapse → geom scope |
| summary | `error_type`, `capsize` | **both** | collapse → geom scope |
| trend | `error_type`, `show_band` | layer | → geom scope |
| line | `alpha`, `linewidth` | layer | → geom scope |
| regression | `show_band` | **MISSING** | **add** CI-band toggle |
| distribution | `dist_render`, `bin_method`, `hist_bins`, `bin_sharpness`, `overlay_smooth` | layer (`hist_bins` was style) | → geom scope (fixes the stray `hist_bins`) |
| tile | `colormap` | **hardcoded "Blues"** | **add** sequential-cmap select |
| tile | `show_counts` | **MISSING** | **add** cell-count overlay toggle |
| *(stat lines)* | `line_width` | style | keep figure-level: shared by regression/summary/trend/density |

Duplicates removed from `StyleOverrides`: `marker_size`, `marker_alpha`,
`jitter`, `layout`, `mark_width`, `error_type`, `capsize`, `notch`,
`outlier_marker`, `outlier_size`, `hist_bins` — all become geom-scoped.

## Registry shape

One entry per knob (engine-emitted, JSON-safe):

```python
{
  "key": "jitter",
  "label": "Jitter",
  "group": "dot",                 # figure | axes | text | annotations | <geom>
  "widget": {"type": "number", "min": 0.0, "max": 0.5, "step": 0.02},
  "default": 0.18,
  "scope": "geom",                # figure | axes | text | annotation | geom
  "applies_to_geoms": ["dot"],    # geom-scoped knobs only
  "visible_when": {"key": "layout", "equals": "jitter"},  # optional cross-knob gate
  "transferable": true,
}
```

`StylePane` becomes a generic renderer: group entries by `group`, drop a group
whose `applies_to_*` doesn't match the live `marks`/`family`, drop an entry whose
`visible_when` fails against current values, render each `widget` (number →
range/number, select → `<select>`, bool → checkbox, text → input, swatch →
the existing color popover). This is the exact pattern `LayerCards` already uses
for `param_specs` — we generalise it.

Storage: `style.overrides` gains a geom-keyed sub-object.

```ts
interface StyleOverrides {
  // figure / axes / text / annotations — flat, as today (minus the removed dups)
  width_mm?: number; /* … */ palette?: string[]; title?: string; /* … */
  geoms?: {                       // geom-keyed style, replaces Layer.params
    dot?: { layout?: "swarm"|"jitter"; jitter?: number; marker_size?: number; alpha?: number };
    box?: { mark_width?: number; notch?: boolean; fill?: boolean; fill_alpha?: number;
            outlier_marker?: …; outlier_size?: number };
    // … one per geom
  };
}
```

Engine: `resolve_style` merges the flat keys onto `STYLE_DEFAULTS` as today; a
new `resolve_geom_style(spec, geom)` merges `overrides.geoms[geom]` onto that
geom's defaults (from the registry). `_param()` and `Layer.params` are deleted.

## The C↔F seam

An exported **style sheet** (item F) is `style.overrides` filtered to
`transferable: true` knobs. Concretely it carries figure, axes-look, palette
(by index), annotation toggles, and all geom-scoped looks; it drops `title`,
`x_label`, `y_label`, `offsets`, and all axis ranges/spacings. Applying a sheet
means merging those keys onto the target plot's `overrides`, geom sections
matched by geom name (a sheet's `box` style applies to the target's box layers;
geoms absent in the target are ignored). Defining `transferable` here means item
F is "filter + merge," with no further style-semantics work.

## Implementation sketch

- **Engine** — add `style_registry()` to `geoms.py` (or a new `style.py`),
  served on `/health` next to `registry_payload()`. Move geom param defaults
  there. Add the new knobs to the relevant builders: `_geom_box` gains
  `patch_artist=True` + facecolor when `fill`; `_geom_violin` reads `fill_alpha`;
  the tile builder reads `colormap`/`show_counts`; regression reads `show_band`.
  Delete `_param()`; add `resolve_geom_style`.
- **Frontend** — rewrite `StylePane` as a generic registry renderer; delete the
  hand-coded fieldsets, the `D` const, and the `marks.has(...)` conditionals.
  Strip style param editors from `LayerCards` (keep `level`). Replace the
  `StyleOverrides` mark keys with the `geoms` sub-object.
- **Tests** — registry completeness (every geom param has a registry entry;
  every entry's `applies_to`/`visible_when` is satisfiable); a render test per
  new knob (box fill, violin alpha, tile cmap, regression band); the
  style-sheet filter (transferable partition round-trips).

## Out of scope

- **Raw matplotlib escape hatch** (rcParams / per-layer kwargs passthrough).
  Deferred — out of this spec by decision. Revisit only if a real user hits a
  curated-vocabulary wall.
- **Per-layer-instance style divergence** (two box layers, different widths).
  Cut deliberately by the geom-keyed decision.
- **Item F itself** (the sheet UI: save/load/apply). This spec only defines the
  `transferable` partition F builds on.
- **Item D** (moving the size preset out of the top row). Touches the same Size
  group but is tracked separately.

## Open questions

1. **Registry location** — extend `geoms.py` vs a new `style.py`. Leaning a new
   `style.py`: the geom registry is about *what data a geom needs*, the style
   registry about *how anything looks*; different axes.
2. **`line_width` (stat lines) home** — kept figure-level because regression,
   summary CI, trend band, and density all share it. Alternative: split into
   per-geom line widths. Leaning keep-shared (it is one visual weight for the
   whole figure's stat overlays).
3. **Palette transfer by index vs by level name** — index (cycle on overflow,
   matches `_group_color`'s `% len`) is simplest and always applies. By-name
   would preserve "treatment = red" across datasets but fails the moment names
   differ. Leaning by-index for the sheet; revisit in F if name-matching proves
   worth it.
