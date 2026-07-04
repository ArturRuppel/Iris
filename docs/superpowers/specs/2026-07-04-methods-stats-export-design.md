# Methods-text / statistics-table export — design

*2026-07-04*

## Purpose

Give a researcher, in one click, the two things a journal asks for when a figure
carries statistics: a **methods paragraph** they can paste into a manuscript, and
a **statistics table** (a "Table S1") listing every test with its numbers. Both
are generated from the document — the analyses already on the canvas — so the
prose and the table can never disagree with the figure, and the software is cited
with the exact engine version and library versions used.

This is the ROADMAP Tier-2 item "Methods-text / statistics-table export —
formatted for supplementary materials, generated from the spec and provenance
log."

## What already exists (and reframes the feature)

The engine **already generates** a publication-ready methods sentence for every
analysis family. `engine/iris_engine/stats.py` returns, per analysis, a
`methods_text` string plus a structured `result` (test name, statistic, df, p, n,
`effect` = {name, value, ci}), a `decision` block with plain-language rationale, a
`checks` list (Shapiro–Wilk), and `summaries` (per-group n/mean/sd/CI). It is
surfaced today in `src/components/StatsPanel.tsx` with a single-analysis "Copy"
button.

So this feature is **assembly + formatting + file export**, not prose generation
from scratch. The engine owns the per-test sentence; we add (a) a document-level
gather across all analyses, (b) a data-shaping preamble the per-test sentence
doesn't cover, (c) a stats table serialized from the structured `result`s, and
(d) a software-citation line from engine identity — then write it to a file via
the same path the figure export uses.

## Scope decisions

**1. Whole-document, not active-analysis-only.** The figure export buttons emit
only the active plottable, but a paper's methods section covers *every* figure.
The multi-analysis plumbing already exists (`allSaveSpecsAtom` builds one spec per
plottable; `saveTablesFor` + `_resolve_save_tables` resolve every referenced
table; `/document/save` already accepts `tables[] + analyses[]`). We reuse it.

**2. Generation stays server-side**, in a new pure module
`engine/iris_engine/methods.py`. Engine owns truth (consistent with `/export` and
"spec is data, engine owns truth"); the formatting is pure and unit-testable in
Python against the validation corpus; and it guarantees every analysis is freshly
computed rather than read from a possibly-evicted client cache.

**3. "Provenance" means the spec + engine identity — we do NOT build a
provenance-recording subsystem here.** The ROADMAP principle "Provenance is
product… edits, filters, test choices, and engine versions are recorded" is
partly aspirational: the `.iris` `provenance` field is an empty `{}` pass-through
today (`src/App.tsx` saves `{}`; `document.py` writes it verbatim; nothing
populates it). Building an edit/audit log is a separate, larger feature. What
genuinely exists as provenance right now, and is enough for honest methods text:
- the **reduce pipeline** (drop/filter/derive/recode/join/pivot/grid_complete +
  spine collapse) — the data shaping, recoverable from `spec.reduce` +
  `spec.hierarchy`;
- the **test decisions** (family, chosen test, alpha, reference/exposure/model,
  describe-only) — from `spec.stats` and the engine's `decision`/`checks`;
- the **engine identity** (version, commit, dirty) and the **library snapshot**
  (scipy/pingouin/statsmodels/pandas versions) — from the document manifest.

We generate from those. If a real provenance log lands later, the software-line
and preamble are the natural places to enrich; nothing here blocks that.

**4. Two output formats behind one control** (mirroring the SVG/PDF/PNG trio):
- **Methods (`.md`)** — a Markdown document: a Methods section (one paragraph per
  analysis) followed by a Statistics table (Markdown table) and a software-citation
  line. Markdown is copy-pasteable, human-readable, and pandoc-converts to
  DOCX/LaTeX. This is the primary deliverable.
- **Stats table (`.csv`)** — the same per-test rows serialized as CSV, for opening
  in a spreadsheet. Cheap to add (same structured rows, different serializer) and
  it is literally the "statistics-table export" the ROADMAP names.

**YAGNI cuts (explicitly out):** no DOCX/LaTeX/HTML emitters (Markdown + pandoc
covers it); no per-edit audit log; no configurable templates; no in-app preview
pane (the file is the deliverable — a follow-up can add a preview reusing the same
engine output); no inclusion of describe-only analyses as "tests" in the table
(they appear in prose only, since they carry no p/statistic).

## Architecture

```
 UI (App.tsx toolbar)                     engine
 ┌───────────────────────┐                ┌──────────────────────────────┐
 │ "Methods (.md)"  ─────┼── POST ───────▶│ /export/methods              │
 │ "Stats (.csv)"        │  {tables[],    │  resolve tables (reuse        │
 │        │              │   analyses[],  │   _resolve_save_tables)       │
 │        ▼              │   format}      │  for each analysis:           │
 │ engine.exportMethods()│                │    _run(load, spec) → stats   │
 │        │              │                │  methods.build_document(...)  │
 │        ▼              │◀── {filename,  │    → markdown | csv bytes     │
 │ downloadBase64()      │    data_base64}│                              │
 └───────────────────────┘                └──────────────────────────────┘
```

### Units and boundaries

- **`engine/iris_engine/methods.py`** (new, pure — no HTTP, no matplotlib). The
  whole testable core:
  - `shaping_prose(spec) -> str` — one sentence describing the reduce pipeline +
    spine collapse for an analysis, or "" when there is nothing to say (no reduce
    steps, no spine). Per-step phrasing for each of the seven reduce kinds plus the
    collapse chain.
  - `stats_rows(analysis) -> list[StatRow]` — flatten one analysis's `stats` into
    zero or more table rows (one per test: the single test, or one per pairwise
    comparison for omnibus families, or one per lane for location/rate). A
    describe-only analysis yields zero rows.
  - `methods_markdown(analyses, manifest) -> str` — the full `.md`: title,
    per-analysis Methods paragraphs (`shaping_prose` + the engine's `methods_text`),
    the Markdown stats table, and the software-citation line.
  - `stats_csv(analyses) -> str` — the stats table as CSV.
  - `software_line(manifest) -> str` — "Statistical analyses were performed in Iris
    vX.Y.Z (commit abc1234) using scipy N, pingouin N, statsmodels N (Python)."
  where `analyses` is a list of `{title, spec, stats, stat_model}` and `manifest`
  carries engine identity + snapshot.

- **`engine/iris_engine/main.py`** — new `@app.post("/export/methods")` handler +
  `ExportMethodsRequest` model. Resolves tables once via `_resolve_save_tables`,
  runs each analysis through `_run` against its referenced table (an analysis
  binds to its table by `spec.table_id`, which equals the `SaveTable.name` that
  `saveTablesFor` emits), assembles the `analyses` list, dispatches on `format`
  to `methods.methods_markdown` / `methods.stats_csv`, returns
  `{filename, data_base64}`.

- **`src/types.ts`** — `engine.exportMethods(tables, analyses, format)` client
  method, mirroring `engine.export`.

- **`src/App.tsx`** — two toolbar buttons next to the figure-export trio, wired to
  `allSaveSpecsAtom` + `saveTablesFor(...)` and `downloadBase64`.

### Data flow for one analysis → table rows

- two-group (`welch_t`/`paired_t`/`mann_whitney`/`wilcoxon`): 1 row — test, n,
  statistic (t/U/W), df (if any), p, effect (name=value [95% CI if present]).
- omnibus (`one_way_anova`/`kruskal`): 1 omnibus row (F/H, df, p, η²/ε²) + 1 row
  per `result.pairwise` entry (a-vs-b, adjusted p, stars, Hedges' g). The
  correction (Tukey/Holm) is named in the omnibus row.
- location: 1 row per `per_group` lane that was tested (test-vs-reference, t/W, p,
  effect); untested lanes (too few) are skipped in the table, noted in prose.
- rate: 1 global row (likelihood-ratio χ², df, p) + 1 row per lane (rate + model
  CI, n); effect column blank (no effect size for a rate).
- correlation: 1 row (r/ρ, n, p, effect r with CI); per-group correlation yields
  one row per group.
- contingency: 1 row (χ²/Fisher, dof, p, Cramér's V / odds ratio + CI).
- descriptive / timeseries / describe-only: 0 rows (prose only).

### Stats-table columns

`Analysis | Comparison | Test | n | Statistic | p | Effect size`

- **Analysis** — the plottable title.
- **Comparison** — the group pair / lane / "overall" (blank for a single-test
  family).
- **Test** — human name ("Welch's t-test", "Mann–Whitney U", …).
- **n** — sample size the test used (pairs for paired, units for spined
  correlation).
- **Statistic** — "t(12.3) = 2.41" / "U = 88" / "χ²(2) = 6.1" / "H(2) = 5.4" — the
  statistic with its df inline, matching how `methods_text` already writes it.
- **p** — formatted as the engine does (`< 0.001` or `= 0.032`).
- **Effect size** — "Hedges' g = 0.62 (95% CI 0.10–1.14)" etc.; blank for rate.

## Failure modes

- **A document with zero analyses, or all describe-only** → the Methods `.md`
  still renders (prose paragraphs + software line), the stats table is a header
  with a "No inferential tests were run." note; the `.csv` is header-only. Never
  an error — an empty table is a valid answer.
- **An analysis that errors** (e.g. a paired test requested on unpaired data — the
  `recoverable` case): its `stats` still carries a `methods_text` explaining the
  situation and a `result.test == "none"`, so it contributes a prose paragraph and
  0 table rows. We surface the prose, skip the row.
- **A table that can't be resolved** (409 from `_resolve_table`) → propagate the
  409 as today; the client already surfaces engine errors. The user reloads data,
  same as for figure export.
- **Missing library in the snapshot** (e.g. statsmodels absent because no rate
  family was used) → the software line lists only the libraries actually present
  in `engine_snapshot`; never fabricate a version.
- **NaN / inf in a statistic** → reuse the engine's existing `_json_safe` / number
  formatting; a non-finite value renders as "—", never a raw `NaN` in prose.

## Testing

- **`engine/tests/test_methods.py`** (new) — the bulk, all pure:
  - `shaping_prose` for each reduce kind and the collapse chain, and the empty
    case (no reduce, no spine → "").
  - `stats_rows` for one analysis of every family: two-group (each of the 4),
    omnibus + pairwise fan-out, location lanes (tested + skipped), rate
    (global + lanes), correlation (plain / per-group / spined), contingency
    (chi-square + Fisher), and the 0-row describe-only/timeseries cases.
  - `methods_markdown` end-to-end on a small multi-analysis fixture: asserts the
    section structure, that every analysis's `methods_text` appears, that the
    table has the right row count, and that the software line names the snapshot
    versions.
  - `stats_csv` round-trips through `csv.reader` to the expected rows.
  - Empty-document and all-describe-only edge cases.
- **`engine/tests/test_engine.py`** (extend) — a `/export/methods` smoke: POST a
  two-analysis document, assert 200, base64 decodes, `.md` contains both titles
  and a `| Test |` table header; and the `.csv` decodes to the expected rows.
- **Frontend** — a `src/App` or client test that `engine.exportMethods` posts the
  `{tables, analyses, format}` body and that the button calls `downloadBase64`
  with the returned filename (mirror the existing figure-export coverage).

## Verification

Run the app, build a 2–3 analysis document (a two-group comparison, a correlation,
a describe-only distribution), click **Methods (.md)** and **Stats (.csv)**, and
confirm: the `.md` opens with a Methods paragraph per analysis whose sentences
match the StatsPanel "methods text", a stats table with a row per test, and a
software line with real versions; the `.csv` opens in a spreadsheet with the same
rows. Then `pandoc methods.md -o methods.docx` to confirm the Markdown is clean.
