# `.iris` File Format Redesign — Design

> Tightens the `.iris` document format around one rule: a file stores **inputs
> and decisions**, never computed output. Adds an engine identity (semantic
> version + commit hash) so a file's results are reproducible, and removes the
> derived fields that are currently stored alongside the decisions and can drift
> stale. Enables a clean headless execution surface (extract stats, render
> figure, render the pipeline diagram).

**Date:** 2026-06-24
**Status:** design, pending implementation plan

---

## Principle

A document records what the user *decided*, not what the engine *computed*. The
data, the steps that shape it, the test the user settled on, the figure's style,
and the provenance are inputs and decisions; they belong in the file. The
p-values, the assumption-check outcomes, whether a pick deviated from the
recommendation, and the rendered figure are all functions of those inputs run
through a specific version of the engine. They do not belong in the file, because
storing a value next to the inputs that produce it invites the two to disagree.

The reproducibility guarantee then has a clean shape: **data + decisions + engine
identity fully determine every computed value.** Anyone with the file and that
engine gets the same numbers; the numbers themselves never need to be carried.

This matches the project stance already recorded for the explorer work: guide and
educate, but the user is responsible. The file is an authoritative declaration of
what to compute, not a record of obedience to Iris's recommendation.

## What is wrong now

The format already half-believes this. `chosen_by` is documented as "descriptive
only," and the user's pinned test rides in a decoupled `override` field
(`src/types.ts:368-389`). But the `stats` block still carries derived and
process state that no longer needs storing:

- `alternatives_offered: string[]` — a snapshot of what the recommender offered
  at save time. Recomputable; goes stale if the recommender changes.
- `assumption_checks: { check, per }[]` — the checks that were run. These are
  outcomes of the data + engine, recomputable.
- `chosen_by` — a label describing the recommendation relationship. The whole
  point below is that this relationship is *derived on open*, so the stored label
  is redundant and can disagree with a re-derivation.

And the engine identity is incomplete. `engine_snapshot` pins library versions
(`engine/iris_engine/main.py:37-41`: python, scipy, pingouin, matplotlib,
seaborn, pandas) but **not Iris's own decision logic**. The test picker, the
thresholds (`NORMALITY_CAP = 5000`, `MIN_N_FOR_NORMALITY_RULE = 12`), the
rank-floor guard, and the pipeline compiler all live in `iris-engine`. Change a
constant in `stats.py` and the same data and same scipy produce a different
recommendation, with nothing in the file to record it. The library snapshot is
necessary but not sufficient.

## Current format (for reference)

A `.iris` is a ZIP (`engine/iris_engine/document.py`):

```
manifest.json          format_version, modified, engine_snapshot
data/schema.json       schema_version, columns[]
data/table.parquet     the table (Parquet, zstd)
analyses/NN-<id>.json  one AnalysisSpec per analysis
provenance.json        source / case / title / ...
```

`FORMAT_VERSION = "1.0"`; load rejects files from a newer format and accepts
older ones (`document.py:19,58`).

## Change 1 — Engine identity

Add the identity of the engine build that produced the file, alongside (not
replacing) the library snapshot.

`manifest.json` gains an `engine` object:

```jsonc
"engine": {
  "version": "1.4.2",          // semantic version, human-readable
  "commit": "a1b2c3d",         // short git hash of iris-engine at build time
  "dirty": false               // true if built from a modified working tree
}
```

Notes:

- **Build-time injection, not runtime `git`.** The packaged app is not a git
  checkout, so the commit cannot be read by shelling out at save time. Stamp it
  into the engine at build time (a generated `__commit__` / `__version__`) and
  read that constant. Equivalent of `git describe --always --dirty`.
- **The dirty flag is load-bearing.** A bare hash from a modified working tree
  claims a reproducibility it does not have: a reader who checks out that commit
  runs different code than actually produced the file. `dirty: true` says
  honestly "built from a modified copy of this commit; exact reproduction not
  guaranteed." In practice only developer builds are ever dirty; released builds
  always come from a clean tagged commit.
- **Keep `engine_snapshot` (library versions)**, demoted to a secondary check.
  The commit identifies Iris's reasoning; the library versions identify the
  numeric backends and stay useful as a fast, standalone, human-readable record
  when no lockfile is at hand.

## Change 2 — Store decisions, not derived values

Trim the `stats` block to the user's decisions. Remove the derived/process
fields and recompute them on open.

Remove from the stored spec:

- `alternatives_offered`
- `assumption_checks`
- `chosen_by`

Keep (these are decisions or inputs):

- `family`, `test` — the design and the test in effect.
- `override` — the user's pinned test (null = run the recommendation). This is a
  decision and stays.
- `reference` — the constant the location family tests against; an input that
  cannot be inferred from column types.
- `alpha` — a decision.
- `report` — the user's choice of what to surface. (Decision; keep. If any part
  of it turns out to be derived, fold that part into the on-open computation.)

The same rule generalizes: no computed result is stored anywhere in the file.

## On-open re-derivation

When a file opens (in the app or headlessly), the engine runs the decisions
against the data and produces the computed layer:

1. **Statistics.** Run the test in effect (the `override` if set, else the
   recommendation) to produce p-values, effect sizes, CIs.
2. **Assumption checks.** Recompute Shapiro–Wilk etc. for display.
3. **Deviation label.** Recompute the recommendation for this data and compare it
   to the test in effect. If they differ, the methods text reports the deviation
   ("Welch's t was used; the recommended test was Mann–Whitney"). This replaces
   the stored `chosen_by` with a live derivation.
4. **Figure.** Render from the spec + style.
5. **Pipeline diagram.** Render the dataflow graph (pending feature).

Because everything in step 1-3 is a function of data + decisions + engine, two
opens of the same file with the same engine are identical, by construction.

### Decision: re-derive against which engine?

The deviation label and methods text depend on *which* recommender we compare
against:

- **Original engine** (the `commit` stored in the file): the methods text matches
  what the user saw when they made the choice. Faithful historical record. This
  is the right default for a methods statement, since that is what reproducibility
  means.
- **Current engine:** "by today's best practice, this is a deviation." Useful as
  a secondary, clearly-labeled signal.

Default to the original-engine derivation for the methods text. Showing both is
possible later but not required for v1.

The stored `commit` is what makes the original-engine derivation possible at all;
this is why Change 1 is a precondition for Change 2 being safe. Without a pinned
engine, a re-derivation could silently drift from what the user saw.

## Headless execution surface

The format being purely declarative makes a headless runner natural: feed a
`.iris` to the engine with no app, and it can emit any computed view.

```
iris run file.iris --stats        # statistics table (JSON / CSV)
iris run file.iris --figure out.pdf   # render the figure (SVG/PDF/PNG)
iris run file.iris --pipeline out.svg # render the pipeline diagram (pending)
```

A file can equally be **authored by a script** (write the table + a decision
spec, no app needed) and then run. This is the same code path the app uses on
open, so a scripted/batch result equals a by-hand result. The pipeline-diagram
output depends on the explorer visualization work and ships when that does.

## Migration

None. Per project stance there are no users and no legacy to preserve. Delete the
removed fields outright, update `spec_version` (and `format_version` if the
manifest shape changes), and regenerate the bundled example `.iris` assets from
source. Loading an old asset is not a goal; rebuilding them is one step.

## Touch points

- `engine/iris_engine/document.py` — manifest `engine` block; stop expecting the
  removed stats fields.
- `engine/iris_engine/main.py` — `engine_snapshot()` stays; add the build-time
  `commit`/`version`/`dirty` source; on-open derivation already lives in the
  analyze path, ensure it no longer reads stored derived fields.
- `src/types.ts` — trim the `AnalysisSpec.stats` shape; add the manifest engine
  type.
- Build tooling — inject the commit/version/dirty at build.
- `src/examples/assets/*.iris` — regenerate.

## Open questions

1. **`report`** — confirm every element of it is a user decision. If any element
   is derived, move it to the computed layer rather than storing it.
2. **Format version bump** — does the manifest change warrant `format_version`
   `2.0`, or only `spec_version`? (Manifest shape changes, so likely both.)
3. **Headless CLI surface** — is `iris run` its own entry point, or a flag on the
   existing engine process? (Out of scope for the format itself; flagged so the
   plan can sequence it.)
4. **Showing original vs current recommendation** — v1 uses original only;
   confirm we do not need the dual display yet.
