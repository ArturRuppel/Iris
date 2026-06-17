# Background figure rendering + cache

**Date:** 2026-06-17
**Status:** Approved design, ready for implementation plan

## Problem

Switching between analyses (plottables) re-renders each figure from scratch, which
is slow on large datasets (the motivating file, `cells_by_frame.iris`, is ~82k rows
/ ~29 MB). Three causes compound:

1. **Every render is full server-side work.** `/analyze` runs reduction →
   hierarchy materialization → stats → a matplotlib SVG render over the full
   server-owned session table. For tens of thousands of rows this is seconds, not
   milliseconds.
2. **No freshness check on the active loop.** The active analyze effect
   (`src/App.tsx:128`) re-fires on every `specKey` / `handle.version` change and
   unconditionally re-fetches — even when switching *back* to an unchanged plot
   whose result is still cached in `analysisByIdAtom`.
3. **Only the active plottable is ever computed.** A plottable the user has not
   opened has no cached figure, so the first visit always pays the full render.

## Goal

Going through analyses shows the plot **instantly**. Specifically:

- A plot whose spec and data are unchanged is shown from cache with no re-render.
- Every plottable's figure is rendered in the background so even a never-opened
  analysis is instant on first visit.
- Bounded memory: a runaway cache must not push an older / low-RAM machine into
  swap. Hundreds of typical plots fit comfortably; only the pathological tail is
  trimmed.

## Non-goals

- Persisting the cache across app restarts (in-session only).
- Parallel rendering across multiple engine workers. The engine is a single
  process and matplotlib is treated as not thread-safe, so renders are serialized
  client-side (one `/analyze` in flight at a time).
- Changing the engine, the wire protocol, or the `AnalyzeResponse` shape.

## Approach

Two cooperating client-side effects sharing one cache, plus a byte-budget LRU.
This is the least invasive option and fits the existing jotai-atoms-plus-effects
pattern in `App.tsx`.

### Cache key (freshness)

Per plottable, the cache is fresh iff the data and the full spec are unchanged:

```
key(p) = `${handle.id}:${handle.version}:${JSON.stringify(spec_of(p))}`
```

The spec already embeds encodings, layers, style, reduce, hierarchy, and the
engine snapshot; `handle.version` captures data edits and exclusion toggles. So
this single string is a complete freshness fingerprint.

New atom: `analysisKeyByIdAtom: Record<string, string>` (plottable id → key the
cached result was computed from). Written **only on a successful render**. Reset
together with `analysisByIdAtom` in `loadTableAtom` and `loadDocumentAtom`.

### Active loop change (`src/App.tsx`)

Before dispatching the existing debounced fetch, add a freshness short-circuit:

- If `analysisKeyById[spec.id] === key`, the cached figure already matches →
  set `analyzeStatus` to `ok` and return without fetching. (Instant.)
- Otherwise behave as today (debounce, `running`, fetch). On success, store the
  result in `analysisByIdAtom` **and** the key in `analysisKeyByIdAtom`.

The existing guards are unchanged: no-Y / no-layer / mapping-error still clear the
analysis and go `idle` before any key logic.

### Background loop (new effect in `src/App.tsx`)

A self-draining sequential queue that warms every other plottable's cache.

Depends on: `allSpecsAtom`, `handle` (`id` + `version`), `analysisKeyByIdAtom`,
and the active render status.

Each run:

1. Do nothing while the active loop is rendering (`analyzeStatus === "running"`)
   or a background render is already in flight (a `useRef` boolean). This keeps
   exactly one `/analyze` in flight at a time.
2. From `allSpecsAtom`, pick the **first** plottable that is:
   - not the active plottable (the active loop owns it and its status), and
   - renderable — has a Y encoding and ≥1 layer and no mapping error (same gate
     the active loop uses), and
   - stale — `analysisKeyById[id] !== key(p)`, and
   - not already failed at this exact key (a `failedKeys` ref `Set<string>` of
     `${id}:${key}`, to avoid re-hammering a config that 422s).
3. Render it via `engine.analyze`. On success, store result + key (the state
   update re-triggers this effect, which then finds the next stale plottable). On
   failure, add `${id}:${key}` to `failedKeys` and move on.

The background loop **never** writes `analyzeStatusAtom` or `renderErrorAtom` —
those remain active-plot-only, so the "Rendering… / ✓ Up to date / ⚠ Render
failed" indicator keeps meaning "the plot you are looking at."

Termination: each successful render makes that plottable's key fresh, so the set
of stale plottables strictly shrinks (modulo the convergence note below). Once
none are stale, the effect finds nothing and stops.

### Convergence note

A plottable's spec depends on its own recommendation, which is fed back from its
own analysis (`specAtom` / `allSpecsAtom` read `analysisByIdAtom[id].stats
.recommendation`). So the **first** render of a plottable may shift its key once
(default test → recommended test). The loop then re-renders it once more and it
settles. Bounded at ~2 renders per plottable; not an infinite loop.

### Memory: byte-budget LRU

The active plot's SVG is the only one ever injected into the DOM; the cache holds
plain JS objects, so 100 cached plots are not 100 live SVG trees. Still, the
worst case (every plot a heavy superplot attributing all ~82k raw rows in
`point_groups`) can reach a few MB each. To protect older / low-RAM machines from
swap (the JS engine's own OOM crash and the OS OOM killer are backstops, but the
*swapping phase before them* is the freeze we want to avoid), bound the cache by
approximate bytes.

- **Size estimate per entry** (cheap, no serialization): `svg.length` plus a
  per-row-id constant times the total count of ids across `point_groups`
  (`Σ entries`, counting each id in a list). A small fixed overhead covers
  `stats` / `stat_model` / `issues`.
- **Budget:** a single tunable constant, default **~300 MB**.
- **Eviction:** track insertion/access recency; when total exceeds the budget,
  evict least-recently-used entries (dropping both the `analysisByIdAtom` result
  and its `analysisKeyByIdAtom` key) until back under budget.
- **The active plottable is never evicted.**
- An evicted plot simply re-renders on revisit (and the background loop re-warms
  it when idle), so eviction is a transparent slowdown, never a correctness
  problem.

This keeps "cache everything" behavior in every realistic case; eviction only
engages on the pathological tail.

## Components touched

| File | Change |
|---|---|
| `src/state.ts` | New `analysisKeyByIdAtom`; reset it in `loadTableAtom` / `loadDocumentAtom`; LRU eviction helper + budget constant; a setter that writes result+key and enforces the budget. |
| `src/App.tsx` | Freshness short-circuit in the active analyze effect; new background-render effect; in-flight ref + `failedKeys` ref. |

No engine, protocol, or `types.ts` changes.

## Data flow

```
data load / document load
  → analysisByIdAtom = {}, analysisKeyByIdAtom = {}

user edits / switches active plottable
  → active effect: key fresh?  yes → show cached, status ok (instant)
                                no  → debounce → fetch → store result+key → status ok

idle (active not rendering, nothing in flight)
  → background effect: first stale non-active renderable plottable
                       → fetch → store result+key (+ enforce LRU budget)
                       → re-trigger until none stale
```

## Error handling

- Active render failure: unchanged — drop the stale figure for that plottable,
  set `renderError`, status `error`.
- Background render failure: record `${id}:${key}` in `failedKeys`, leave
  `analysisByIdAtom` untouched, move to the next plottable. No user-visible error
  (it is not the plot they are looking at). If the user later switches to that
  plottable, the active loop attempts it again and surfaces the error normally.

## Testing

- **Freshness short-circuit (unit):** with a cached key equal to the current key,
  the active effect performs no fetch; with a differing key it does. (Mirrors the
  existing channels/state unit-test style; mock `engine.analyze`.)
- **Background drain (unit):** given N plottables and a stubbed `engine.analyze`,
  the background loop renders each stale plottable exactly until fresh, one at a
  time, never the active one, and stops when all are fresh.
- **Failure does not loop (unit):** a plottable whose render rejects is attempted
  once per key, then skipped.
- **LRU eviction (unit):** filling past the budget evicts least-recently-used
  entries, never the active one, and total stays under budget.
- **Manual:** load `cells_by_frame.iris`, build several analyses, confirm
  switching is instant after the background pass and that editing one plot only
  re-renders that one.

## Risks / open questions

- **Byte-estimate accuracy:** `svg.length` + id count is an approximation, not a
  true heap measurement. It is monotonic with real cost, which is all the LRU
  needs; the budget has headroom for the constant-factor error.
- **Background load after every data edit:** an exclusion toggle bumps
  `handle.version`, invalidating *all* keys, so the background loop re-renders
  every plottable. This is correct but can be a burst of work on large data. The
  serialized one-at-a-time queue and the "yield while active is rendering" gate
  keep it from contending with the user's current plot; acceptable for now.
</content>
</invoke>
