# Loadable / applicable style sheets

**Date:** 2026-06-17
**Status:** Draft
**TODO item:** F (New UX / styling items)
**Depends on:** C (rationalize-plot-style) — the `transferable` partition and the
geom-keyed `style.overrides` shape are defined there; this spec consumes them.

## Problem

Once a user has tweaked one plot's look — palette, frame, tick style, box fill,
font — there is no way to reuse it. Every other plot, in this file or another,
must be re-styled by hand from defaults. We want to **capture a plot's style as a
reusable sheet and apply it to other plots**, within the same file and across
files.

Spec C already did the hard semantic work: it consolidates all styling into one
plot-level `style.overrides` object and tags each knob `transferable` (look) vs
not (content — titles, labels, axis ranges, drag offsets). A **style sheet is
exactly the transferable slice of `style.overrides`.** So F is not new style
semantics — it is *capture, storage, and apply* built on C's partition.

The TODO asks for two reaches: "another plot in file" and "another file". Those
need different lifetimes, so F provides three tiers (all requested):

1. **In-session copy/paste** — right-click an analysis → *Copy style*; paste onto
   one or many analyses. Covers same-file and any file open this session.
2. **Named library** (localStorage) — *Save as style…* → a persisted, named sheet
   applied later via a menu. Survives restarts; spans every file.
3. **Export/import `.iris-style` file** — a small JSON a user downloads and loads
   elsewhere. Shareable with a colleague, git-able, portable across machines.

## Decision summary

- **A style sheet is the transferable slice of `style.overrides`.** Concretely:
  the flat keys whose registry entry (C's `style_registry`) is
  `transferable: true`, plus the entire `overrides.geoms` sub-object (all geom
  looks are transferable). Excluded: `title`, `x_label`, `y_label`, `offsets`,
  and all axis ranges/spacings (`x/y_min`, `x/y_max`, `x/y_tick_spacing`).
- **One apply function, three sources.** Clipboard paste, library apply, and file
  import all funnel through `applyStyleSheet(target, sheet) → StyleOverrides`:
  merge the sheet's transferable keys onto the target's `overrides`; merge geom
  sections by geom name (a sheet's `box` style lands on the target's box layers;
  geoms the target lacks are ignored); palette carried **by index** (cycles on
  overflow, matching `_group_color`'s `% len`). Content keys on the target are
  untouched.
- **Whole sheet, selectable targets.** Apply is all-or-nothing on the *knobs*
  (no per-group opt-out — keeps the model and UI simple), but the *targets* are
  chosen: paste/apply act on the analysis multi-selection.
- **Multi-select the analysis list.** To "paste onto a selection of analyses,"
  the sidebar gains standard multi-select (Cmd/Ctrl-click toggles, Shift-click
  ranges, plain click resets to one). The *active* (edited) plottable stays
  single — the last clicked. The selection set drives batch style ops only.
- **Capture is from a plottable, paste is a context-menu action.** *Copy style*
  and *Paste style* join the existing analysis context menu (next to
  Rename / Duplicate / Delete). Library + file controls live in the Style pane
  footer (and Import alongside the existing Load .iris button).
- **No legacy** ([[no-legacy-no-users]]): `.iris-style` ships at version 1.0;
  the in-app clipboard is an atom, not persisted.

## The style sheet

```ts
interface StyleSheet {
  iris_style_version: "1.0";
  name: string;              // user label; "" for an unnamed clipboard sheet
  style: TransferableStyle;  // the transferable slice of StyleOverrides
}
```

`TransferableStyle` is `StyleOverrides` minus the content keys above. There is no
separate type to maintain by hand — it is produced by `captureStyle(overrides)`:

```ts
// transferableKeys: derived once from registryAtom — the flat style_registry
// entries with transferable === true. Geom looks always travel.
function captureStyle(o: StyleOverrides): TransferableStyle {
  const out: TransferableStyle = {};
  for (const k of transferableKeys) if (o[k] !== undefined) out[k] = o[k];
  if (o.geoms) out.geoms = structuredClone(o.geoms);
  return out;
}
```

Because the partition comes from the registry (C's source of truth), adding a new
knob in C automatically classifies it for F — F has no parallel list to drift.

### Apply / merge

```ts
function applyStyleSheet(target: StyleOverrides, sheet: StyleSheet): StyleOverrides {
  const next = { ...target, ...sheet.style };       // flat transferable keys win
  if (sheet.style.geoms)                             // geom sections merge by name
    next.geoms = mergeGeoms(target.geoms, sheet.style.geoms);
  return next;                                        // content keys on target survive
}
```

- `mergeGeoms` overlays each geom section the sheet carries; a geom the sheet
  doesn't mention keeps the target's value; a geom the target's layers don't use
  is stored harmlessly (ignored at render, like any unused override).
- **Palette by index**: the sheet's `palette` array replaces the target's
  wholesale; the engine already cycles `% len`, so a 3-colour sheet on a 5-level
  plot repeats colours rather than erroring. (By-name level matching is an open
  question carried from C — deferred.)
- Apply is a pure transform on `Plottable.style`; the existing freshness key
  (`cacheKey`, which hashes the spec incl. style) re-renders the targets
  automatically. No new render plumbing.

## UI

### Analysis context menu (`PlottableSidebar.tsx`)

```
┌─────────────────────┐
│ Rename              │
│ Duplicate           │
│ Delete              │
│ ───────────────     │
│ Copy style          │   ← captureStyle(plottable.style) → clipboard atom
│ Paste style         │   ← applyStyleSheet onto every selected analysis
│ Apply saved style ▸ │   → submenu: [named library sheets] (+ "Manage…")
└─────────────────────┘
```

- *Copy style* captures from the right-clicked analysis.
- *Paste style* is enabled iff the clipboard atom is non-empty; it applies to the
  **current multi-selection** (or just the right-clicked row if it isn't part of
  a selection). A toast/inline note states "Applied style to N analyses."
- *Apply saved style ▸* lists localStorage sheets by name; same target rule.

### Multi-select

- `selectedPlottableIdsAtom: string[]` (insertion-ordered). Plain click →
  `[id]` + active = id. Cmd/Ctrl-click → toggle id in the set (active = id).
  Shift-click → range from active to id. Selected rows get an `.selected` class
  distinct from the single `.active` (edited) row.
- Right-clicking a row that's *in* the selection keeps the selection; clicking
  one *outside* it resets selection to that row (file-manager convention).

### Style pane footer (`StylePane.tsx`)

Extend the existing footer (`Reset label positions`, `Reset all`):

```
[ Save as style… ]  [ Export… ]   [ Import… ]
```

- *Save as style…* → name prompt → `captureStyle(active.style)` into the
  localStorage library.
- *Export…* → download `<name>.iris-style` (the JSON above).
- *Import…* → file picker; a loaded sheet goes into the clipboard atom (ready to
  paste) and is offered to be saved to the library. (Top-bar Import next to
  *Load .iris* is an optional convenience, not required.)

## Persistence tiers

| Tier | Storage | Lifetime | Reaches |
|---|---|---|---|
| Clipboard | `styleClipboardAtom` (in-memory) | session | this file + files open this session |
| Library | `localStorage["iris.styleLibrary"]` (array of `StyleSheet`) | across restarts | every file, this machine |
| File | `.iris-style` JSON download/upload | forever | other machines, colleagues, git |

The library mirrors the existing `iris.typeColors` localStorage pattern
(`state.ts`); an `atomWithStorage<StyleSheet[]>("iris.styleLibrary", [])` plus a
small manage dialog (rename/delete entries) is the whole of it.

## Implementation sketch

- **`src/style/sheet.ts`** — `captureStyle`, `applyStyleSheet`, `mergeGeoms`, the
  `transferableKeys` selector off `registryAtom`, and `.iris-style` (de)serialise
  with a version guard. Pure + unit-testable headlessly.
- **`state.ts`** — `styleClipboardAtom`, `styleLibraryAtom` (atomWithStorage),
  `selectedPlottableIdsAtom`, and a `pasteStyleAtom` writer that maps the merge
  over the selection.
- **`PlottableSidebar.tsx`** — multi-select click handling; Copy/Paste/Apply menu
  items; the saved-style submenu.
- **`StylePane.tsx`** — footer buttons; name prompt; export download; import
  picker (reuse `downloadBase64` / `fileToBase64` from App).
- **Tests** — `captureStyle` drops content keys & keeps geom looks; `applyStyleSheet`
  merges geoms by name, leaves content untouched, cycles a short palette;
  `.iris-style` round-trips and rejects a newer version; paste-over-selection
  hits exactly the selected ids.

## Out of scope

- **Per-group apply** (colors-only, skip-axes). Whole-sheet only by decision; the
  data model wouldn't change if added later.
- **By-level-name palette matching** ("treatment = red" across datasets). Carried
  from C as an open question; index-based for now.
- **A sheet that carries content** (titles/labels/ranges). Definitionally
  excluded — those are per-plot.
- **Bundling sheets into `.iris`.** The `.iris` document format is frozen at v1.0
  ([[cellflow-iris-relationship]]); style sheets are a separate artifact and do
  not touch it.
- **Auto-apply / "default style for new analyses."** Tempting follow-up (a
  pinned library sheet applied to every new plottable) but a separate feature.

## Open questions

1. **Import destination** — clipboard (paste when ready) vs straight into the
   library vs both. Leaning clipboard + an offer to save, so import and in-app
   copy share one "ready to paste" surface.
2. **Apply across *all* analyses shortcut** — beyond the selection, is an
   explicit "Apply to all analyses in this file" worth a menu item? Leaning yes,
   cheap, and it's the obvious "make the whole figure set consistent" gesture.
3. **Library scope** — global (all projects) vs per-table. localStorage is global
   by nature; a style is data-agnostic (palette-by-index, no column names), so
   global seems right. Confirm.
