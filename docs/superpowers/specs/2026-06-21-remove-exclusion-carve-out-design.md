# Remove Exclusion — Carve It Out, Filter on a Flag Instead

*Design spec — 2026-06-21*

## Purpose

Iris carries a dedicated row-**exclusion** mechanism: an `excluded` bookkeeping
column, a toggle endpoint, a `respect_exclusions` spec flag, a provenance log of
toggles, and a ✕ column in the grid. This is a *second way to do one thing* —
dropping rows from an analysis — that the general **filter** reduce step already
does on any column.

This spec removes the exclusion mechanism entirely. "Exclude a row" becomes:
edit a boolean flag column (the grid is already bool-editable), then filter on it
with a normal `reduce` step (`{kind: "filter", conditions: [{column: <flag>,
op: "==", value: false}]}`).

### Why (data-principles rationale)

This change came out of evaluating the `.iris` format against the sibling
electronic-lab-notebook project's data principles. Exclusion was the one piece of
**curated human judgment** baked into the `.iris` document. Removing it makes a
`.iris` a pure function of **(input table + analysis spec)** — a clean,
reproducible *automatic-derived* artifact whose judgment lives **upstream**, in
whatever pipeline sets the flag column, where its own provenance ("why/who/when a
row was flagged") belongs. Iris just declares "I filtered on `<flag> == false`",
which is honest and fully reproducible.

## Approach (decisions locked in)

- **Subtractive.** Delete the mechanism; do not add a replacement — the
  replacement (bool-flag column + `filter` step) already exists and is tested.
- **Keep bool normalization.** `_load_frame`'s `bool → numeric` block
  (`main.py:368-379`) stays — it is exactly what makes "filter on a boolean flag
  column" work, and is unrelated to exclusion.
- **Decision 1 — drop the "N excluded" reporting entirely.** The methods-text
  clause ("N observation(s) were excluded") and the figure "· N excluded" badge
  go away. Methods text simply reflects the filtered `n`. Re-sourcing a dropped-
  row count from filter steps is explicitly out of scope (possible later feature).
- **Decision 2 — no backward-compat migration; regenerate the corpus.** Pre-
  alpha. Old `.iris` files still *load* (the engine reads `respect_exclusions`
  via `.get(..., True)`, so an absent/ignored flag is harmless; a leftover
  `excluded` column just becomes an ordinary bool→numeric column). Their
  previously-excluded rows re-enter the analysis — documented as a known break.
  The validation corpus is regenerated as the new ground truth.

## What is removed vs. kept

**Removed** — the `excluded` bookkeeping column, the `/table/{tid}/exclude`
endpoint + `ExcludeRequest`, `toggle_exclusion`, the `respect_exclusions` spec
field, the `n_excluded` provenance/attr path, the exclusion log atom + provenance
array, the ✕ grid column, and the figure "N excluded" badge.

**Kept** — `id` bookkeeping column; the `bool → numeric` normalization; the
general `filter` reduce step; everything else.

## Blast radius

### Engine (Python)

| File | Change |
|---|---|
| `session.py` | drop `toggle_exclusion()` (68-74); `counts()` (83-86) → `{"total": n}` only |
| `main.py` | delete `/table/{tid}/exclude` + `ExcludeRequest` (623-630); strip the exclusion mask **and** the `n_excluded` attr from `_load_frame` (360-367), keeping the bool→numeric block (368-379); simplify `_prepare` (383-384) to no `respect_exclusions`; drop the `excluded` auto-inject in `table_create` (598-599); drop `respect_exclusions=True` args at `/reduce` (660) and `/hierarchy` (685) |
| `reduce.py` | `_meta_cols` (71-73) keeps `id`, drops `excluded`; remove the `n_excluded` carry (115, 122) |
| `stats.py` | delete `_excl_note` (40-44) and its call sites (Decision 1) |
| `importer.py` | `RESERVED_NAMES` (28) drops `excluded`; remove the `[False]*len` inject (284) |
| `hierarchy.py` | remove `out["excluded"] = False` (62) |
| `document.py` | drop `excluded` from sample rows (88, 141) and the `_infer_schema` skip-list (110). `save_document`/`load_document` take a generic `provenance` dict — no format change; callers simply stop sending `exclusions`. |

### Frontend (TypeScript)

| File | Change |
|---|---|
| `state.ts` | delete `ExclusionEvent` (134), `exclusionLogAtom` (135), `toggleExclusionAtom` (140-147); drop `respect_exclusions` from the default spec (555); remove from reset (397) and doc-load (497, 519) |
| `types.ts` | drop `Row.excluded` (14), `TableCounts.excluded` (19, 22), `data.respect_exclusions` (289), `provenance.exclusions` (436), the `toggleExclude` client (565) |
| `DataTable.tsx` | remove the ✕ column def (60-69), the `field === "excluded"` edit branch (113-115), the `rowClassRules={{ excluded }}` (171) |
| `FigurePane.tsx` | remove `nExcluded` (245) and the badge (253) |
| `App.tsx` | remove `exclusionLogAtom` import/use (15, 69) and `exclusions` in save (261) / load (270) |
| CSS | remove the `.excluded` row style referenced by the dropped `rowClassRules` |

### Tests / fixtures / validation

- Strip `"excluded": False` from the engine test fixtures and `respect_exclusions`
  from their specs (`test_tile`, `test_n_labels`, `test_facets`, `test_aesthetics`,
  `test_multigroup`, `test_horizontal`, `test_contingency`, `test_paired`,
  `test_hierarchy`, `test_guards`, `test_timeseries`, `test_reduce`, `test_engine`),
  plus `harness.py` (68, 74) and `src/state.test.ts` (18).
- Rewrite the dedicated exclusion tests to filter-on-flag: `test_session.py`
  (toggle/counts) and `test_tile.py:259` (`row["excluded"] = True`).
- Drop `respect_exclusions` from all 9 validation `case.py` files.
- **Regenerate the 12 `.iris` artifacts** via `engine/validation/build.py`.

## New regression guard

Add one validation case proving the replacement is **equivalent** to the removed
behavior: a dataset with a boolean flag column, filtered via a `reduce` `filter`
step, must reproduce the stats that `respect_exclusions` used to produce —
asserted against independently recomputed scipy/pingouin ground truth (per the
corpus's existing contract).

## Sequencing

1. Engine core: `session` → `main` (`_load_frame`/`_prepare`/endpoints/`create`)
   → `reduce` (`_meta_cols`) → `importer` → `hierarchy` → `document`.
2. `stats` methods text (Decision 1).
3. Frontend: `types` → `state` → `DataTable`/`FigurePane`/`App` → CSS.
4. Tests/fixtures: strip flags, rewrite the two exclusion tests, add the
   regression case.
5. Regenerate the validation `.iris` artifacts via `build.py`.
6. Note the removal in the README/changelog: "exclusion removed; use a boolean
   flag column + a filter step."

## Done when

- `pytest` (engine) green; `tsc` clean; `vite build` succeeds; validation harness
  green with regenerated artifacts.
- No reference to `excluded` / `respect_exclusions` / `toggle_exclusion` /
  `n_excluded` remains outside unrelated prose (e.g. stats-glossary wording about
  CIs "excluding 0").
- The new regression case demonstrates filter-on-flag ≡ the old exclusion result.

## Out of scope

- Re-sourcing a dropped-row count from filter steps for methods text (Decision 1).
- Backward-compat migration of pre-carve-out `.iris` documents (Decision 2).
