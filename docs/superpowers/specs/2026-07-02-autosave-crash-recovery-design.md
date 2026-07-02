# Autosave / crash recovery — design

**Date:** 2026-07-02
**Roadmap item:** Tier 2, "Autosave / crash recovery — continuous local
snapshots beside the `.iris`."

## Problem

A crash, an accidental tab close, or a killed shell loses everything since the
last explicit Save. The working state is entirely in-memory: the spec state
(plottables, pool metadata) lives in Jotai atoms in the page; the table data
lives in engine sessions that die with the engine process.

## Where snapshots live: engine-side, one code path for both contexts

The GUI runs in two contexts — the Tauri desktop shell (engine sidecar) and
plain browser dev mode (vite + a manually started engine). Both talk to the
same local engine over localhost HTTP, and **the engine is the only component
with unconditional filesystem access in both**. So snapshots are written by
the engine, to a directory it owns, through three small `/autosave/*`
endpoints. One implementation, unit-testable in pytest, e2e-testable in plain
browser dev mode; no Tauri-side code at all.

The roadmap phrase "beside the `.iris`" is not implementable as written: File
System Access API handles never expose a filesystem path — even under Tauri,
Save rides the web FS API — so neither the page nor the engine knows where the
bound `.iris` lives. Snapshots therefore go to a per-user app-data directory:

- `IRIS_AUTOSAVE_DIR` env var when set (tests, unusual setups), else
- Linux: `$XDG_DATA_HOME/iris/autosave` (default `~/.local/share/iris/autosave`)
- macOS: `~/Library/Application Support/iris/autosave`
- Windows: `%APPDATA%/iris/autosave`

The desktop shell is the **primary context** (it's where real documents are
edited); dev mode gets identical behavior for free because the engine is the
same. One snapshot slot per user — two concurrent Iris windows would share it,
last writer wins. Accepted for v1 (matches the single-document workspace).

## What a snapshot contains: two tiers, no new format

The constraint: no second document format. The observation: spec state changes
every few seconds while editing; table data (hundreds of MB in sessions)
changes rarely — on import, load, a cell edit, or a schema retype. So:

- **Data tier — `snapshot.iris`.** A byte-for-byte standard 2.1 `.iris`
  (written by the same `document.save_document`, tables read from live
  sessions exactly like `/document/save`). Rewritten **only when the data
  fingerprint changes** — the client sends
  `JSON([pool id, session id, session version] per table)` with every
  snapshot; the engine compares it to the stored one.
- **Spec tier — `state.json`.** A sidecar rewritten on **every** snapshot:
  `{written, data_fingerprint, analyses, tables: [{name, hierarchy}],
  provenance}`. `analyses` are the already-serializable 2.1 `AnalysisSpec`
  save specs (the exact JSON that goes in a `.iris`'s `analyses/`); the
  per-table hierarchies cover spine reorders / level-fn edits, which don't
  bump the session version. Plain JSON of existing shapes — no new format.

**Restore** = `load_document(snapshot.iris)`, then overlay the sidecar's
analyses and per-table hierarchies (they are newer or equal), then create
sessions exactly like `/document/load`. The sidecar can never reference a
table missing from the `.iris`: any pool change that could add a reference
also changes the data fingerprint, forcing a data-tier rewrite in the same
snapshot call. Writes are atomic (tmp + `os.replace`), data tier before spec
tier, so a crash mid-snapshot can only leave a *conservative* pair (old
sidecar + new `.iris` → next snapshot rewrites the data tier), never a sidecar
pointing at stale data.

### Engine API

- `POST /autosave/snapshot` `{tables: SaveTable[], analyses, provenance,
  data_fingerprint}` — sidecar always; `.iris` only when the fingerprint moved
  or the file is missing. Body is parsed manually (accepts `text/plain`) so
  the page-close flush can be a CORS "simple request" — no preflight to
  complete during unload.
- `GET /autosave/status` → `{exists, written, n_analyses, tables}`.
- `POST /autosave/restore` → the `/document/load` response shape (sessions
  created), from the snapshot + sidecar overlay.
- `POST /autosave/clear` — delete the slot.

## When the client snapshots: a semantic dirty key

Autosaving whenever specs exist would leave a snapshot after load-and-quit,
producing a bogus restore offer. And the *built* specs (`allSaveSpecsAtom`)
jitter without user edits — the recommended test and derived family settle
asynchronously as renders and reduce previews land. So dirtiness is computed
from the **source** state instead:

> `snapshotStateKey` = JSON of (plottables stripped of session-only fields
> (`previewLevel`, step `_key`) + pool metadata (id, name, schema, hierarchy,
> session id, session version)).

A **baseline** key is captured at app start (empty workspace), after a
document load, and after a successful explicit Save. The autosave effect runs
only while `current key ≠ baseline` — i.e. only when there is real unsaved
work. Import keeps the empty baseline (imported-but-unsaved data *is* unsaved
work). Restore-from-snapshot deliberately does **not** reset the baseline
(recovered work still has no explicit save), so autosaving resumes.

Triggers:
- **Debounced edit snapshot** (~1.5 s after the last dirtying change) — the
  steady-state protection against crashes.
- **Page-hide flush** (`pagehide` + `visibilitychange→hidden`, keepalive
  fetch) — covers the accidental-tab-close race inside the debounce window.
  Best-effort: `keepalive` bodies are capped at 64 KB, but the payload is
  references + spec JSON, never rows, so it fits in practice.

## Recovery UX

- On launch (after `/health`), the client asks `/autosave/status`. If a
  snapshot exists — and existence *means* unsaved work, because explicit Save
  clears the slot — a banner offers **Restore** / **Discard** with the
  snapshot's timestamp and content summary. Nothing is restored or deleted
  silently.
- **Restore** loads it through the normal `loadDocumentAtom` path (bound file
  handle cleared → next Save prompts, mirroring `handleOpenExample`), keeps
  the workspace dirty, and leaves the slot in place until an explicit Save
  clears it or the next autosave overwrites it with the same content.
- **Discard** clears the slot.
- The banner shows only while the workspace is empty. If the user ignores it
  and imports/loads instead, the banner yields and the new session's autosaves
  may overwrite the slot — the single-slot compromise, chosen over blocking
  autosave indefinitely behind an unanswered banner.
- **Explicit Save / Save As** (including the no-FS-Access download path)
  cancels any pending debounce, awaits an in-flight snapshot, resets the
  baseline, and clears the slot. A snapshot can therefore never outlive the
  save that supersedes it (modulo a crash in that same instant, which leaves a
  restore offer identical to the saved file — annoying once, never lossy).

## Out of scope

- Undo/redo stacks — session-only by design; they don't survive.
- Multiple snapshot slots / snapshot history.
- Statistics — untouched.
