# COV2D Capability Showcase + Guide Chapter — Design

**Date:** 2026-06-24
**Status:** approved (brainstorm), pending implementation plan

## Goal

The recently-landed transformation capabilities — the reduce vocabulary
(`derive`/`recode`/`join`/`pivot`/`grid_complete`/expression-`filter`), the
post-collapse `reduce.post` phase, editable collapse routing (un-forced nesting),
and the never-blocking guards — currently have **no presence in the gallery or
the guide**. The one COV2D-absorption case that exists (`cov2d-tier-a`) isn't even
exported to the gallery. This project makes the new capabilities visible: a small
set of COV2D-shaped showcase examples plus an accompanying capstone chapter in
`docs/guide.md`.

## Decisions (from the brainstorm)

1. **Role — showcase, not validation.** These are gallery/visualization examples,
   **smoke-only**: they must build and render, but carry *no pinned reference
   numbers*. Rationale: Iris implements every reduce step as a thin pandas wrapper
   (`_apply_join`→`df.merge`, `_apply_pivot`→`df.pivot_table`,
   `_apply_grid_complete`→cross-join+`groupby`+`fillna`) and every test as a
   scipy/pingouin call. Re-deriving either with the same library is circular —
   pandas-vs-pandas / scipy-vs-scipy. The genuinely Iris-specific glue (spec→pandas
   interpretation, the nested-median collapse fold, grid 0-fill, `id` re-stamping,
   the `reduce→collapse→reduce.post→stat` phase order) is already covered by the
   engine's pytest suite (`test_reduce_*`, `test_reduce_post_phase`,
   `test_cov2d_tier_a`, `test_guards_routing`, `test_shape_counts`, the validation
   corpus). A pinned float in a gallery example would re-assert that through scipy —
   validation theater. So correctness stays the unit suite's job; these examples
   exist to **showcase and document**.

2. **Data — COV2D-shaped synthetic.** Continue the `cov2d-tier-a` lineage: small,
   deterministic, constructed (no RNG, or seeded) datasets shaped like the COV2D
   corpus (`experiment_id`/`position_id`/`cell_id`/`frame`). The new capabilities
   exist *because of* COV2D §3/§5, so this is the most motivated showcase and ties
   to the absorption narrative. The real COV2D data/notebook is **not** in this
   repo (it lives in a separate data repo), so synthetic stand-ins are required
   regardless.

3. **Authoring path — reuse the existing case machinery, no harness changes.**
   Each example is a `case.py` under `engine/validation/cases/<name>/` with
   **empty** `expected_stats`/`expected_model` dicts and a minimal structural
   `expected_figure` (e.g. `xtick_labels`, `axis_labels`). `validate()` iterates
   those dicts, so empty ones assert nothing beyond `assert_figure`'s unconditional
   `has_svg` — i.e. "the pipeline ran and an SVG rendered." `test_validation.py`
   auto-discovers every case folder via `case_dirs()`, so each new example is
   smoke-tested for free. Gallery export adds the case name to `GALLERY_CASES` in
   `export_gallery.py`; `test_export_gallery.py` already guards round-trip +
   byte-determinism. Committed assets are regenerated with `npm run examples:build`.

4. **Doc — one capstone chapter in `docs/guide.md`.** `guide.md` is both the repo
   doc and the in-app guide (`Guide.tsx` imports it `?raw`; the markdown token
   `![](example:<caseId>/<analysisId>)` embeds a gallery SVG inline). The chapter
   is example-driven and placed after *Experimental design and nesting*, before
   *References* — the applied finale that builds on the grammar, the tests, and
   nesting.

## The example set — 3 new figures + 1 surfaced

All COV2D-shaped, deterministic, smoke-only.

### Figure 1 — §5 event-rate landscape ("the free win")
- **Capabilities:** `grid_complete` (a `position × transition-type` grid where an
  absent cell is a real **0**, not missing — honest rate denominators),
  expression-valued `filter` (data-dependent clip, e.g. drop rows above the 99th
  percentile of `|L|`), `derive` (rate = events / exposure).
- **Shape:** per-event records keyed by experiment/position with a transition-type
  categorical and a displacement/exposure numeric → a rate plot across transition
  types.
- **Structural smoke:** `xtick_labels` = the transition-type levels.

### Figure 2 — §3 enrichment (post-collapse derive)
- **Capabilities:** `reduce.post` — a post-collapse `derive` of `log2(Σobs/Σexp)`
  at the experiment grain — plus the **post-aggregate-derive caution guard** and a
  visible `reduce → collapse → reduce.post → stat` phase order.
- **Shape:** per-cell obs/exp counts nested in experiment/position/cell → collapse
  to experiment grain → post-derive the log2 enrichment → one-sample location test
  vs 0.
- **Structural smoke:** renders; `axis_labels.y` mentions enrichment.

### Figure 3 — motility SuperPlot with editable routing + guards
- **Capabilities:** editable collapse **routing** (choose the test grain rather
  than the enforced finest-first spine), the **pseudoreplication** guard (fires
  when the chosen grain is too fine) and the **pairing-flip** guard. The
  **identity-merge** guard surfaces here too where a routing step drops a
  dimension.
- **Shape:** per-frame motility nested experiment/position/cell/frame, two
  conditions, N=3 replicates → a SuperPlot (cell-level points + replicate-level
  summary) demonstrating how re-routing moves the unit of inference.
- **Structural smoke:** renders; `point_groups`/`legend_labels` for the two
  conditions.

### Figure 4 — cov2d-tier-a (existing case, surfaced to the gallery)
- **Capabilities:** `join` (broadcast a per-cell class label onto per-frame rows)
  + `recode` (relabel the class) + nested-median flatten + paired-t with Hedges g.
- **Action:** already built and *genuinely* validated (it reproduces the notebook's
  `paired_by_replicate` p-value); keep its real `expected_stats`. Only change: add
  `"cov2d-tier-a"` to `GALLERY_CASES` and use it as the chapter opener.

### Coverage map
join, recode, grid_complete, expression-filter, derive, reduce.post, routing,
pseudoreplication / pairing-flip / post-aggregate-derive / identity-merge guards.

### Deferred — `pivot`
`pivot` (the §4 `opp` long→wide reshape) is the one listed capability whose natural
home is **§4, which is being executed on a separate thread**. Authoring a competing
pivot example here risks collision. **Deferred:** add a pivot showcase example + a
chapter entry once §4 lands. Recorded in `TODO.md`.

## The guide chapter — `# Reshaping real data`

Placed after *Experimental design and nesting*, before *References*. Example-driven,
each figure embedded inline. Outline:

1. **Why reshaping belongs in the spec** — the table-in / figure-out boundary;
   "spec is data, not code"; the reduce vocabulary as declarative transformation.
2. **From per-frame rows to a SuperPlot** (fig 4) — `join` + `recode` + the
   collapse chain.
3. **Honest rates need a complete grid** (fig 1) — `grid_complete` 0-fill +
   data-dependent `filter` + `derive`.
4. **Deriving after the collapse** (fig 2) — `reduce.post` and why the
   post-aggregate-derive guard earns its keep.
5. **Choosing the unit of inference** (fig 3) — editable routing + the
   pseudoreplication / pairing-flip guards (cross-link to *Experimental design and
   nesting*).

## Out of scope

- No engine code changes — every capability already exists on `main`.
- No harness changes — empty expectation dicts ride the existing `validate()` path.
- No pinned reference numbers for the new examples (smoke-only by decision 1).
- `pivot` showcase (deferred to the §4 thread).

## Testing

- `test_validation.py` smoke-runs each new case (build + render).
- `test_export_gallery.py` guards gallery round-trip + byte-determinism for the
  new `GALLERY_CASES` entries.
- Manual: render each figure and eyeball it (`engine/validation/build.py` writes
  SVGs to `artifacts/` for spot-checking); read the chapter in-app via the guide.
