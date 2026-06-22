# In-app Examples Gallery — Design

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan

## Problem

Iris ships no learning material. A new user opening the app sees an empty data
table and has no way to understand what plots Iris can draw, what experimental
designs it supports, or how the test-picker maps a design to a test. The 14
curated validation cases (real, cited datasets with `.iris` artifacts) are a
perfect teaching corpus, but they are invisible — built on demand into a
gitignored `artifacts/` directory, used only by the test suite.

We want a comprehensive, browsable **Examples gallery inside the app**: a
long-form document rendered like markdown, with statistical plots inline and
explanatory prose around them, where each example can be **opened directly into
the current session** so the user can explore and tweak it. The gallery must be
a *reference* — covering **every plot type** and **every supported experimental
design × test**, not just a showcase of the existing cases.

## Goals

- A third top-level view (**Examples**, alongside Data / Analyses) that renders a
  curated markdown document with prose + inline plots.
- A **table of contents** with two parts:
  - **Part I — Plot types:** every geom in the grammar, with "what it shows /
    when to use it" prose and an inline example.
  - **Part II — Experimental designs & tests:** every supported design, showing
    the parametric default and the robust alternative side by side, plus the
    geom each pairs with. A master design × test × geom matrix sits at the top.
- Each example has a single primary action: **Open in Iris** — loads the bundled
  `.iris` into the current session.
- **Originals stay intact:** a document opened from the gallery has no backing
  file, so the existing Save flow behaves as Save-As. A guard warns if a user
  aims Save at a known example filename.
- Examples reuse the **validation corpus** (real cited data, already
  round-trip-tested). Prose is authored fresh; citations are lifted from each
  case's `case.py`.

## Non-goals (YAGNI)

- Public static documentation site or JOSS web page (separate future effort).
- "Save a copy" / download-to-directory button (Open → save-from-there covers it).
- Live thumbnail rendering (plots are pre-rendered SVGs bundled at export time).
- Search / filter / tag UI over examples.
- Synthetic toy datasets for plot-type demos — demos reuse real cited data.

## Coverage taxonomy (the reference target)

Authoritative inventory from the engine. The gallery must cover all of it.

### Primary geoms (Part I)

| Geom | Family | Shows | Example source |
|---|---|---|---|
| `dot` | group_comparison | every observation as a point | analysis on iris-species data |
| `box` | group_comparison | quartiles + whiskers + outliers | existing comparison cases |
| `violin` | group_comparison | KDE distribution shape | analysis on iris-species data |
| `bar` | group_comparison | mean ± error | analysis on iris-species data |
| `summary` | group_comparison | mean ± error, no bar | analysis on iris-species data |
| `scatter` | correlation | two numeric variables | iris-petal-correlation |
| `regression` | correlation | OLS fit + 95% CI band (layer) | iris-petal-correlation |
| `line` | timeseries | per-unit trajectories over ordered x | **new** time-series case |
| `trend` | timeseries | mean ± spread band over ordered x | **new** time-series case |
| `distribution` | descriptive | histogram / KDE / density | iris-sepal-descriptive |
| `tile` | contingency | count matrix / heatmap | contingency-2x2 |

### Annotation layers (Part I)

| Layer | Trigger | Example source |
|---|---|---|
| Significance brackets | test result with p-value | existing comparison/ANOVA cases |
| Reference line | location family / `reference_value` | one-sample-location |
| Sample-size (n) labels | `show_n` style knob | enable on one existing case |

### Experimental designs × tests (Part II)

| Design | Parametric | Robust | Typical geom | Example source |
|---|---|---|---|---|
| One sample vs reference | one_sample_t | wilcoxon_signed | box/dot + ref line | one-sample-location (param); **new** robust case |
| Two independent groups | welch_t | mann_whitney | box / violin | iris-species-comparison; mann-whitney |
| Two paired groups | paired_t | wilcoxon | box + connectors | sleep-paired-t; sleep-wilcoxon |
| 3+ independent (one-way) | one_way_anova + Tukey HSD | kruskal + Holm | box + brackets | iris-species-anova; kruskal |
| Association (two numeric) | pearson | spearman | scatter + regression | iris-petal-correlation; iris-petal-spearman |
| Two categorical | chi_square | fisher_exact (2×2) | tile | contingency-2x2; fisher-exact-tea |
| Distribution (one var) | — (descriptive) | — | histogram | iris-sepal-descriptive |
| Time course | — (describe-only) | — | line / trend | **new** time-series case |

### Corpus gaps to fill

1. **New time-series case** — a real, citable longitudinal/ordered dataset;
   covers `line` + `trend` geoms and the "describe-only time course" design row.
   Explicitly labeled "descriptive, no inferential test yet."
2. **New robust one-sample case** — small-n dataset that routes to
   `wilcoxon_signed`; covers the robust cell of the one-sample design row.
3. **Geom-variant analyses** — add `violin` / `bar` / `dot` / `summary` analyses
   onto an existing comparison dataset (e.g. iris-species). The exporter already
   emits one SVG per analysis, so these are extra analyses, not new datasets.
4. **n-labels demo** — enable `show_n` on one existing case for the annotation
   example.

New cases follow the existing validation contract (`data.csv` + `case.py` with
cited reference statistics + assertions), so they are tested and cited like the
rest of the corpus.

## Architecture

### Single corpus

Gallery examples **are** validation cases. No second corpus. Plot-type demos
reuse real cited datasets rendered with different geoms. Everything flows
through the existing validation build pipeline.

### Asset pipeline

New exporter `engine/validation/export_gallery.py`:

- Takes a curated, ordered list of `(case, analysis-id-for-plot)` entries.
- For each, builds the `.iris` bytes (via `harness.build_iris`) and renders the
  chosen analysis to SVG (via `compiler.figure_to_svg`).
- Writes `<caseId>.iris` and `<caseId>__<analysisId>.svg` plus a generated
  `manifest.json` into `src/examples/assets/`.
- `manifest.json` maps `caseId → { title, irisFile, plots: [{ analysisId,
  svgFile }], filename }`. The frontend imports this for asset URLs + metadata.

Driven by an npm script `examples:build` that invokes the Python exporter. The
generated assets are **committed to git** (SVGs are text; `.iris` are small
zips), so the *frontend* build stays pure-JS and the assets are reviewable in
diffs. Regenerated explicitly when content or cases change.

### Content authoring

The document is one authored markdown file `src/examples/gallery.md` containing
the full narrative (TOC, Part I, Part II, master matrix), with two custom tokens:

- **Inline plot:** `![](example:<caseId>/<analysisId>)` → resolved via manifest
  to the bundled SVG, rendered inline in a `<figure>`.
- **Action link:** `[Open this example in Iris](iris-open:<caseId>)` → rendered
  as an **Open in Iris** button wired to the open handler.

Prose is authored by hand; dataset source + statistical citation are lifted from
each case's `case.py` `NOTES` / `SOURCE`.

### Rendering layer

- Add the **`react-markdown`** dependency.
- New component `src/ExamplesGallery.tsx` imports `gallery.md?raw` and the
  generated `manifest.json`, renders with `react-markdown` plus custom component
  overrides:
  - `img` override: `src` starting with `example:` → resolve via manifest,
    render inline `<figure>` with the SVG (inline `<svg>` for crisp, themable
    output, fetched/imported as raw text).
  - `a` override: `href` starting with `iris-open:` → render an **Open in Iris**
    button bound to `handleOpenExample(caseId)`.
- New CSS classes (`.gallery`, `.gallery-prose`, `.gallery-figure`,
  `.gallery-open-btn`) in `src/index.css`, using existing palette variables.

### View integration

- Extend `viewModeAtom` (`src/state.ts`) from `"data" | "analyses"` to add
  `"examples"`.
- Add an **Examples** button to the header `mode-toggle` (`src/App.tsx`).
- Render `<ExamplesGallery/>` in a scrollable `.examples-mode` container when
  active.

### Open-in-Iris + original integrity

- `handleOpenExample(caseId)` (in `App.tsx`, reusing the existing load seam):
  1. `fetch` the bundled `.iris` URL → `ArrayBuffer` → base64.
  2. `engine.loadDocument(b64)` → `loadDocumentAtom(...)` (same path as `doLoad`,
     with `analyses.map(migrateSpec)`).
  3. `setViewMode("analyses")`.
  4. **Clear `fileHandleRef.current = null`** so there is no backing file — the
     next Save is therefore Save-As. The bundled asset is never touched.
- **Overwrite guard** in the save flow (`doSave`): if the chosen save target's
  filename matches a manifest example filename, show a confirm warning — *"This
  will overwrite an example file that ships with Iris; the Examples
  documentation will no longer match it. Continue?"* — and proceed only on
  confirm.
  - *Assumption:* in the packaged app the bundle is read-only, so the guard
    mainly protects the dev/repo workspace and any example a user has copied to
    disk. Acceptable for now.

## Data flow

```
validation/cases/<case>  ──build_iris──▶  .iris bytes
                         ──figure_to_svg─▶  .svg text
        (export_gallery.py, npm run examples:build)
                         │
                         ▼
        src/examples/assets/ { <case>.iris, <case>__<analysis>.svg, manifest.json }
                         │  (committed, bundled by Vite)
                         ▼
   gallery.md (authored prose + tokens)  +  manifest.json
                         │
                         ▼ react-markdown + custom img/a overrides
              ExamplesGallery view (Part I + Part II)
                         │  [Open in Iris]
                         ▼
   fetch .iris ▶ engine.loadDocument ▶ loadDocumentAtom ▶ viewMode="analyses"
                         (fileHandleRef cleared → Save = Save-As)
```

## Error handling

- **Missing/failed asset fetch on Open:** surface a non-fatal error via the
  existing error-surfacing path (`surfaceUnlessAbort`); the gallery stays usable.
- **Unknown token in `gallery.md`** (`example:` / `iris-open:` referencing a
  caseId absent from the manifest): render a visible inline placeholder
  (`⚠ unknown example "<id>"`) rather than crashing, so authoring mistakes are
  caught in review.
- **Stale manifest:** the engine round-trip test (below) fails if a bundled
  `.iris` no longer loads, forcing a rebuild.

## Testing

- **Engine:** test that every `.iris` referenced in `manifest.json` round-trips
  through `document.load_document` (catches stale/broken exports). New validation
  cases get the standard case assertions (cited reference statistics).
- **Frontend unit:** the `img` / `a` token-resolution overrides — `example:` and
  `iris-open:` tokens resolve via a fixture manifest; unknown ids render the
  placeholder.
- **Frontend e2e (Playwright):** switch to the Examples view → see prose + an
  inline plot; click **Open in Iris** → lands in Analyses with the analysis
  loaded; assert Save behaves as Save-As (no backing file handle); exercise the
  overwrite-warning path.

## Files touched / added

- `engine/validation/cases/<new-timeseries>/` — new case (data + case.py).
- `engine/validation/cases/<new-robust-one-sample>/` — new case.
- Geom-variant analyses added to an existing comparison case.
- `engine/validation/export_gallery.py` — new exporter.
- `src/examples/gallery.md` — authored content (new).
- `src/examples/assets/` — generated, committed (`.iris`, `.svg`, `manifest.json`).
- `src/ExamplesGallery.tsx` — new view component.
- `src/App.tsx` — Examples toggle, `handleOpenExample`, save overwrite guard.
- `src/state.ts` — extend `viewModeAtom`.
- `src/index.css` — gallery styles.
- `package.json` — add `react-markdown`; add `examples:build` script.
