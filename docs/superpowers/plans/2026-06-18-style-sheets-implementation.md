# Style Sheets (Item F) — Implementation Plan

**Date:** 2026-06-18
**Spec:** `docs/superpowers/specs/2026-06-17-style-sheets-design.md`

## Tasks

- [x] **1. `src/style/sheet.ts`** — Pure logic module
  - `StyleSheet` / `TransferableStyle` types
  - `transferableKeys(registry)` — derive the set of flat keys with `transferable: true`
  - `captureStyle(overrides, registry)` — extract the transferable slice
  - `mergeGeoms(target, source)` — overlay geom sections by name
  - `applyStyleSheet(target, sheet)` — merge sheet onto target, content keys survive
  - `serializeStyleSheet(sheet)` / `parseStyleSheet(json)` — `.iris-style` JSON with version guard

- [x] **2. State atoms (`state.ts`)**
  - `styleClipboardAtom: atom<StyleSheet | null>` — in-session clipboard
  - `styleLibraryAtom: atomWithStorage<StyleSheet[]>("iris.styleLibrary", [])` — named library
  - `selectedPlottableIdsAtom: atom<string[]>` — multi-selection (insertion-ordered)
  - `pasteStyleAtom` — writer: apply sheet to every selected plottable

- [x] **3. Multi-select in `PlottableSidebar.tsx`**
  - Plain click → `[id]`, active = id
  - Cmd/Ctrl-click → toggle id in selection, active = id
  - Shift-click → range from active to id
  - Right-click inside selection → keep selection; outside → reset to that row
  - `.selected` CSS class on selected rows (distinct from `.active`)

- [x] **4. Context menu additions (`PlottableSidebar.tsx`)**
  - Separator after Delete
  - Copy style → `captureStyle` → clipboard atom
  - Paste style (disabled when clipboard empty) → apply to multi-selection
  - Apply saved style ▸ → submenu listing library entries

- [x] **5. StylePane footer (`StylePane.tsx`)**
  - "Save as style…" → name prompt → capture into library
  - "Export…" → download `.iris-style` JSON
  - "Import…" → file picker → parse → clipboard atom (+ offer to save)

- [x] **6. CSS** — `.selected` row, context-menu separator, submenu arrow, footer buttons

- [x] **7. Unit tests (`src/style/sheet.test.ts`)**
  - `captureStyle` drops content keys, keeps geom looks
  - `applyStyleSheet` merges geoms by name, leaves content untouched, cycles short palette
  - `.iris-style` round-trips; rejects a newer version
  - Paste-over-selection hits exactly the selected ids

- [x] **8. Typecheck + build + test suite green**
