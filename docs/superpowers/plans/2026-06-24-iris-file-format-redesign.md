# `.iris` File Format Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `.iris` file store **inputs and decisions only, never computed output**, and add an **engine identity** (version + commit + dirty) so the file's results are reproducible. Concretely: stamp the engine build into `manifest.json`; remove the derived `stats` fields (`alternatives_offered`, `assumption_checks`, `chosen_by`) and the inert `report` constant; promote the describe-only *decision* to its own stored field; regenerate the bundled example assets.

**Design source:** `docs/superpowers/specs/2026-06-24-iris-file-format-redesign-design.md`.

**Architecture:** The engine already recomputes `chosen_by`, assumption checks, and the recommendation on every `/analyze` (`engine/iris_engine/stats.py`, `statmodel.py`) — nothing in the engine reads those values back from a stored spec. The three derived `stats` fields are therefore **write-only artifacts** produced solely by `src/state.ts:buildSpec`. Removing them is deletion on the producer + type + test fixtures + asset regen, with **no on-open re-derivation work** (steps 1–3 of the design's "on-open" list already exist). The one piece of genuinely new logic is the build-time engine stamp, injected at PyInstaller build time by `engine/iris-engine.spec` and read at runtime via a small accessor with a git fallback for source/dev runs.

**Tech Stack:** Python 3 / pandas / FastAPI / PyInstaller (engine, `pytest`, run from `engine/`); React / TypeScript / jotai / Vite (frontend, `vitest`, `tsc`, Playwright e2e, run from repo root).

**Key findings that shape the plan (verified against code):**
- **`describe_only` is a decision that currently rides inside `chosen_by`.** `StatsPanel.tsx:242` toggles `p.describeOnly`; `buildSpec` encodes it as `chosen_by: "describe_only"` (`state.ts:569`); `fromSpec` recovers it via `chosen_by === "describe_only"` (`state.ts:506`). Removing `chosen_by` **requires** a dedicated `describe_only: boolean` in the stored `stats`, or the toggle stops round-tripping.
- **`report` is inert.** `state.ts:612` writes a frozen constant; no UI mutates it and no engine code reads `.report`. It is not a decision today → drop it. (Resolves design open-question #1. If a "what to report" control ships later, re-add it as a real decision then.)
- **Engine ignores the removed fields on load**, so removal cannot break analyze; the risk surface is test fixtures and asset regen, both mechanical.
- **`reference` and `override` stay** — genuine inputs/decisions, already correctly stored.

**Decisions taken in this plan (resolving design open questions):**
- **Q1 `report`:** drop (inert, see above).
- **Q2 versions:** bump `FORMAT_VERSION` `"1.0" → "2.0"` (manifest shape changes) **and** `spec_version` `"2.0" → "2.1"` (stats shape changes). Per the no-legacy stance, *do not* write a back-compat migration for the removed fields — `fromSpec`/`migrate` just stop reading them.
- **Q3 headless CLI (`iris run`):** out of scope for this plan (format-only).
- **Q4 original-vs-current recommendation:** v1 keeps the existing live (current-engine) derivation for the methods text; storing the commit is the *precondition* for an original-engine derivation later but that derivation is **not built here**.

**Conventions:** run engine commands from `engine/`; frontend commands from repo root. Each code task is TDD (failing test first) except the pure mechanical regen/fixture tasks, which are guarded by an existing round-trip test added in Phase 1.

---

## Phase 0 — Engine identity (the only new logic)

### Task 0: Runtime build-identity accessor with git fallback

**Files:**
- Create: `engine/iris_engine/build_info.py`
- Test: `engine/tests/test_build_info.py`

The accessor returns `{version, commit, dirty}`. At build time the `.spec` writes a generated `iris_engine/_build_stamp.py` (Task 2); at runtime the accessor prefers that stamp, else falls back to `git describe --always --dirty` from the package directory, else a last-resort `{version: <pyproject>, commit: "unknown", dirty: true}`.

- [ ] **Step 1: Write the failing test** — `test_build_info.py`:
  - `build_identity()` returns a dict with keys `version` (str), `commit` (str), `dirty` (bool).
  - When `_build_stamp.py` is importable (monkeypatch a fake module into `sys.modules`), its constants are returned verbatim and **no** `git` subprocess is spawned (assert via monkeypatched `subprocess.run` raising if called).
  - When the stamp is absent and `git` returns `"a1b2c3d-dirty"`, result is `{commit: "a1b2c3d", dirty: True, ...}` (parse `--dirty` suffix).
  - When the stamp is absent and `git` fails (non-zero / `FileNotFoundError`), result is the last-resort dict with `dirty: True` and `commit: "unknown"`.
- [ ] **Step 2: Implement `build_info.py`:**
  - `def build_identity() -> dict:` — try `from . import _build_stamp` → return `{"version": _build_stamp.VERSION, "commit": _build_stamp.COMMIT, "dirty": _build_stamp.DIRTY}`.
  - On `ImportError`, run `git -C <pkg dir> describe --always --dirty --abbrev=7`; strip a trailing `-dirty` into the `dirty` bool; `version` from the installed package metadata (`importlib.metadata.version("iris-engine")`, default `"0.0.0+unknown"`).
  - On any failure, the last-resort dict.
  - Keep it import-cheap (no top-level `git` call).
- [ ] **Step 3: Run** `cd engine && python -m pytest tests/test_build_info.py -q` — green.

### Task 1: Stamp the manifest; keep `engine_snapshot` as a secondary check

**Files:**
- Modify: `engine/iris_engine/document.py` (`save_document`, `FORMAT_VERSION`)
- Modify: `engine/iris_engine/main.py` (thread the identity into the save path)
- Test: `engine/tests/test_document.py` (create if absent; else extend)

- [ ] **Step 1: Write the failing test** — round-trip a saved document and assert:
  - `manifest["format_version"] == "2.0"`.
  - `manifest["engine"]` has `version`/`commit`/`dirty` (from `build_identity()`).
  - `manifest["engine_snapshot"]` is still present (library versions retained).
- [ ] **Step 2: Implement:**
  - `FORMAT_VERSION = "2.0"`.
  - `save_document(...)` gains the manifest `engine` block from `build_identity()` (import inside the function or pass through — match how `engine_snapshot` is already threaded). Keep `engine_snapshot` in the manifest.
  - Locate the save call site in `main.py` (the `/save` handler / `SaveRequest`) and ensure the engine block is populated there if `save_document`'s signature changes.
- [ ] **Step 3:** `cd engine && python -m pytest tests/test_document.py -q` — green.

### Task 2: Build-time stamp generation in the PyInstaller spec

**Files:**
- Modify: `engine/iris-engine.spec`
- Modify: `engine/.gitignore` (ignore the generated `iris_engine/_build_stamp.py`) — create/append.

- [ ] **Step 1: Implement** — at the top of `iris-engine.spec`, before `Analysis(...)`, shell out to `git describe --always --dirty --abbrev=7` and read the version from `pyproject.toml`, then write `iris_engine/_build_stamp.py` containing `VERSION`, `COMMIT`, `DIRTY` literals. This guarantees every **bundled** binary carries a real stamp; source/dev runs fall back to Task 0's git path.
- [ ] **Step 2: Gitignore** the generated `_build_stamp.py` so it never lands in source control (the runtime fallback covers source checkouts).
- [ ] **Step 3: Verify the build path** — `cd engine && pyinstaller iris-engine.spec` produces `dist/iris-engine`; run it and hit `/health` (or the save path) to confirm `manifest.engine.commit` is the real short hash and `dirty` reflects the tree. (If a full PyInstaller build is too heavy for the loop, instead unit-test that the spec's stamp-writing helper, factored into a small function, emits a valid module.)

---

## Phase 1 — Trim stored stats + promote `describe_only` (frontend)

### Task 3: Pin the current round-trip, then change the shape

**Files:**
- Modify: `src/types.ts` (`AnalysisSpec.stats` shape; `spec_version` literal; add manifest `engine` type)
- Modify: `src/state.ts` (`buildSpec`, `fromSpec`/`plottableFromSpec`)
- Test: `src/state.test.ts`

- [ ] **Step 1: Add a failing round-trip test** in `state.test.ts` — `buildSpec(p, ...)` then `plottableFromSpec(spec)` preserves `override`, `reference`, **and `describeOnly`** for: (a) a group comparison with an override, (b) a `location` analysis with a reference, (c) a describe-only analysis. Assert the produced `spec.stats` has **no** `alternatives_offered`, `assumption_checks`, `chosen_by`, or `report` keys, and **has** `describe_only`. This test currently fails (those keys are written; `describe_only` does not exist).
- [ ] **Step 2: Update the type** (`types.ts:394-410`) — new `stats` shape:
  ```ts
  stats: {
    family: StatsFamily;
    test: TestName;
    override?: TestName | null;   // pinned test; null = run the recommendation
    reference?: number | null;    // location family only
    describe_only?: boolean;       // user's describe-only decision (was chosen_by)
    alpha: number;
  };
  ```
  Remove `chosen_by`, `alternatives_offered`, `assumption_checks`, `report`. Bump `spec_version: "2.1"`. Add an `IrisManifest` (or extend the existing manifest type at `types.ts:413`/`487`) with `engine: { version: string; commit: string; dirty: boolean }`.
- [ ] **Step 3: Update `buildSpec`** (`state.ts:600-613`) — emit only the kept fields; replace `chosen_by` with `describe_only: p.describeOnly` (omit when false, to keep specs clean); delete the `alternatives_offered`/`assumption_checks`/`report` lines; keep the `override`, `reference`, `alpha` lines. Remove the now-dead local `const chosen_by = ...` (`state.ts:569`).
- [ ] **Step 4: Update `plottableFromSpec`** (`state.ts:497-506`) — `override: s?.override ?? null` (drop the legacy `chosen_by === "user_override"` fallback, per no-legacy); `describeOnly: s?.describe_only ?? false` (was `s?.chosen_by === "describe_only"`).
- [ ] **Step 5: Update `migrate()`** if it references the removed fields — bump the target `spec_version` to `"2.1"`; it must not synthesize `chosen_by`/`alternatives_offered`/`assumption_checks`/`report`. (Per no-legacy, do not add a 1.0→2.1 stats migration; just stop emitting the dead keys.)
- [ ] **Step 6: Run** `npx tsc --noEmit && npx vitest run src/state.test.ts` — green. Fix any other `types.ts` consumers the compiler flags (e.g. `StatsPanel.tsx:276` reads `model.chosen_by` — that's the *computed* `StatModel.chosen_by`, **not** the spec field, so it stays; confirm the compiler agrees).

---

## Phase 2 — Engine + fixture cleanup

### Task 4: Strip removed fields from engine test fixtures

**Files (all under `engine/tests/`):** `test_engine.py`, `test_tile.py`, `test_contingency.py`, `test_horizontal.py`, `test_paired.py`, `test_timeseries.py`, `test_facets.py` (grep `alternatives_offered|assumption_checks|chosen_by` for the full set).

- [ ] **Step 1:** Remove `alternatives_offered`, `assumption_checks`, `chosen_by`, and `report` keys from every inline spec fixture. The engine ignores them, so this is shape-alignment only.
- [ ] **Step 2:** `cd engine && python -m pytest -q` — full suite green. (If any test *asserts* on a removed field, that assertion was testing write-only state and should be deleted.)

---

## Phase 3 — Regenerate assets + verify

### Task 5: Regenerate bundled example `.iris` assets

**Files:** `src/examples/assets/*.iris` (+ `manifest.json`), regenerated by `engine/validation/export_gallery.py`.

- [ ] **Step 1:** `npm run examples:build` (→ `cd engine && python -m validation.export_gallery`). Confirm regenerated `.iris` manifests carry the new `engine` block and the new `stats` shape (spot-check one with `unzip -p src/examples/assets/mann-whitney.iris manifest.json` and `... analyses/01-*.json`).
- [ ] **Step 2:** `npm run build` so `dist/assets/*.iris` regenerate from source; confirm no stale-format assets remain.

### Task 6: End-to-end round-trip verification

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run` — full frontend suite green.
- [ ] **Step 2:** Run the Playwright e2e (Chromium is available in this sandbox) for the save→load path: create an analysis (incl. a describe-only one and a location/override one), save, reload, assert the test/override/reference/describe-only survive and the figure re-renders. Extend an existing save/load e2e rather than adding a new harness if one exists.
- [ ] **Step 3:** Manual smoke: save a doc, `unzip -p doc.iris manifest.json` shows `format_version: "2.0"` + a real `engine.commit`; the analysis JSON has no `chosen_by`/`alternatives_offered`/`assumption_checks`/`report`.

---

## Verification checklist (before claiming done)

- [ ] `cd engine && python -m pytest -q` green.
- [ ] `npx tsc --noEmit` clean; `npx vitest run` green; e2e save/load green.
- [ ] A freshly saved `.iris` manifest has `format_version: "2.0"` and an `engine` block with a real commit; a dev/source save shows `dirty: true`, a clean tagged build shows `dirty: false`.
- [ ] Saved analyses contain none of the four removed keys and round-trip `override` / `reference` / `describe_only`.
- [ ] Bundled `src/examples/assets/*.iris` and `dist/assets/*.iris` are regenerated, not hand-patched.

## Out of scope (tracked, not built here)

- Headless `iris run --stats/--figure/--pipeline` CLI (design Q3).
- Original-engine (vs current-engine) recommendation/deviation display (design Q4) — the stored `commit` is the precondition; the dual derivation is a later feature.
- Pipeline-diagram render (depends on the explorer visualization work).
