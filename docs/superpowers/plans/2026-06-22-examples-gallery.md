# In-app Examples Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app **Examples** view — a long-form, markdown-rendered reference that covers every plot type and every supported experimental design × test, with inline plots and an "Open in Iris" action per example that loads a bundled `.iris` into the session without overwriting the original.

**Architecture:** Gallery examples *are* validation cases (real cited data, already round-trip-tested). A Python exporter renders each curated case to a bundled `.iris` + per-analysis `.svg` plus a `manifest.json` under `src/examples/assets/` (committed). A new `ExamplesGallery` React component renders an authored `src/examples/gallery.md` with `react-markdown`, using custom `img`/`a` overrides to resolve `example:<case>/<analysis>` tokens to inline SVGs and `iris-open:<case>` tokens to Open buttons. Opening fetches the bundled `.iris`, loads it through the existing engine load seam, and clears the file handle so Save behaves as Save-As.

**Tech Stack:** Python (iris_engine, validation harness), React 18 + TypeScript + Jotai, Vite (`?raw` / `import.meta.glob` asset imports), `react-markdown` (new dep), vitest (unit), Playwright `.mjs` (e2e).

---

## File Structure

**Engine / corpus (Python):**
- Create `engine/validation/cases/timeseries-growth/data.csv` + `case.py` — time-series case (`line` + `trend`, describe-only).
- Create `engine/validation/cases/one-sample-wilcoxon/data.csv` + `case.py` — robust one-sample case (`wilcoxon_signed`).
- Modify `engine/validation/cases/iris-species-comparison/case.py` — add `violin`/`bar`/`dot`/`summary` analyses (geom coverage; `dot` carries `show_n` for the n-labels demo).
- Create `engine/validation/export_gallery.py` — gallery exporter + curated case list + `manifest.json` writer.
- Create `engine/validation/test_export_gallery.py` — round-trip test for every bundled `.iris`.

**Frontend (TypeScript/React):**
- Modify `src/state.ts:191` — extend `viewModeAtom` union with `"examples"`.
- Create `src/examples/tokens.ts` — pure token parsers (unit-testable).
- Create `src/examples/tokens.test.ts` — vitest unit test for the parsers.
- Create `src/examples/assets/` — generated, committed (`*.iris`, `*.svg`, `manifest.json`).
- Create `src/examples/ExamplesGallery.tsx` — the gallery view component.
- Create `src/examples/gallery.md` — authored content (TOC + matrix + Part I + Part II).
- Modify `src/App.tsx` — Examples toggle, `handleOpenExample`, save overwrite guard.
- Modify `src/index.css` — gallery styles.
- Modify `package.json` — add `react-markdown` dep + `examples:build` script.
- Create `e2e/examples_test.mjs` — e2e for the gallery view + Open-in-Iris + Save-As behavior.

---

## Phase A — Corpus expansion (engine)

### Task A1: New time-series validation case (`line` + `trend`)

**Files:**
- Create: `engine/validation/cases/timeseries-growth/data.csv`
- Create: `engine/validation/cases/timeseries-growth/case.py`

Uses the classic **Orange tree growth** dataset (5 trees, circumference at 7 ages; Draper & Smith 1998 / R `datasets::Orange`). Time series is describe-only in the engine, so assertions are deterministic (no scipy recompute needed).

- [ ] **Step 1: Create the dataset**

`engine/validation/cases/timeseries-growth/data.csv` (35 rows):

```csv
tree,age,circumference
1,118,30
1,484,58
1,664,87
1,1004,115
1,1231,120
1,1372,142
1,1582,145
2,118,33
2,484,69
2,664,111
2,1004,156
2,1231,172
2,1372,203
2,1582,203
3,118,30
3,484,51
3,664,75
3,1004,108
3,1231,115
3,1372,139
3,1582,140
4,118,32
4,484,62
4,664,112
4,1004,167
4,1231,179
4,1372,209
4,1582,214
5,118,30
5,484,49
5,664,81
5,1004,125
5,1231,142
5,1372,174
5,1582,177
```

- [ ] **Step 2: Write the case (failing — no expected count yet matched)**

`engine/validation/cases/timeseries-growth/case.py`:

```python
"""Orange tree circumference over time — the time-series family (describe-only).

Five trees measured at seven ages. Iris's time-series family describes the
trajectories (`line`) and the mean ± spread band (`trend`); it runs no
inferential test in this tier, so the case guards the describe-only verdict and
the figure structure, not a p-value.
"""

TITLE = "Orange tree growth over time"
DATA = "data.csv"
SOURCE = "Draper & Smith (1998), Applied Regression Analysis; R datasets::Orange"
NOTES = """\
Circumference (mm) of five orange trees at seven ages (days since 1968-12-31).
Time series is describe-only in this tier: the engine reports timepoint count and
x-span and renders trajectories / trend band, with no inferential test.
"""
SCHEMA_OVERRIDES = {"tree": {"type": "categorical"}}

_BASE = {
    "spec_version": "2.0",
    "title": TITLE,
    "data": {"filter": []},
    "encodings": {"x": {"column": "age"}, "y": {"column": "circumference"},
                  "color": None, "size": None, "shape": None},
    "reduce": {"steps": []},
    "stats": {"alpha": 0.05},
}

ANALYSES = [
    {
        "spec": {**_BASE, "encodings": {**_BASE["encodings"], "color": {"column": "tree"}},
                 "layers": [{"geom": "line", "params": {}}]},
        "expected_stats": {"n": 35},
        "expected_model": {"family": "timeseries", "chosen_by": "describe_only"},
        "expected_figure": {"axis_labels": {"x": "age", "y": "circumference"}},
    },
    {
        "spec": {**_BASE, "layers": [{"geom": "trend", "params": {}}]},
        "expected_stats": {"n": 35},
        "expected_model": {"family": "timeseries", "chosen_by": "describe_only"},
        "expected_figure": {"axis_labels": {"x": "age", "y": "circumference"}},
    },
]
```

- [ ] **Step 3: Build and validate the case**

Run (from `engine/`, with the engine venv active):
```bash
python -m validation.build timeseries-growth
python -m pytest validation/test_validation.py -k timeseries_growth -v
```
Expected: build prints `built timeseries-growth.iris  (+2 svg)`; pytest PASS.

If `expected_model`/`expected_stats` mismatch the engine's actual output (e.g. `family`/`chosen_by` string differs, or `n` resolves differently), read the failure message, correct the literals to match the engine's real result, and re-run until green. Do **not** weaken an assertion to hide a real disagreement — if the family isn't `timeseries`, investigate the encoding/geom instead.

- [ ] **Step 4: Commit**

```bash
git add engine/validation/cases/timeseries-growth
git commit -m "validation: add Orange-tree time-series case (line + trend)"
```

---

### Task A2: New robust one-sample validation case (`wilcoxon_signed`)

**Files:**
- Create: `engine/validation/cases/one-sample-wilcoxon/data.csv`
- Create: `engine/validation/cases/one-sample-wilcoxon/case.py`

Small-n (n=9 < `MIN_N_FOR_NORMALITY_RULE`=12) sample tested against a reference, so the engine deterministically routes to `wilcoxon_signed`. Exact `W`/`p` are recomputed with scipy (matching the corpus convention of an independent recompute in `NOTES`).

- [ ] **Step 1: Create the dataset**

`engine/validation/cases/one-sample-wilcoxon/data.csv`:

```csv
sample,measure
1,105.2
2,98.7
3,110.4
4,102.9
5,107.6
6,99.8
7,112.3
8,104.1
9,108.5
```

- [ ] **Step 2: Compute the reference statistics**

Run (from `engine/`):
```bash
python -c "
import scipy.stats as ss
v = [105.2,98.7,110.4,102.9,107.6,99.8,112.3,104.1,108.5]
ref = 100.0
d = [x-ref for x in v]
w = ss.wilcoxon(d)
print('n =', len(v))
print('W =', w.statistic, 'p =', w.pvalue)
import statistics; print('median =', statistics.median(v))
"
```
Record the printed `W`, `p`, and `median` — these become the literals in Step 3 (`p` as a `("<", bound)` bound, `W` exact, `center` = median).

- [ ] **Step 3: Write the case (using the recorded numbers)**

`engine/validation/cases/one-sample-wilcoxon/case.py` — fill `W`, `p`, `center` from Step 2's output:

```python
"""One sample vs a reference value, small n — the robust location family.

Nine measurements tested against a reference of 100. With n < 12 the engine's
small-sample rule selects the Wilcoxon signed-rank test rather than the
one-sample t (the parametric sibling is the `one-sample-location` case). The
reference line is drawn at 100.
"""

TITLE = "Measure vs reference (Wilcoxon signed-rank, small n)"
DATA = "data.csv"
SOURCE = "Synthetic; W/p recomputed with scipy.stats.wilcoxon (see NOTES)"
NOTES = """\
Nine values tested against reference = 100. n < 12 triggers the small-sample
rule, so the engine selects the Wilcoxon signed-rank one-sample test.

Independent recompute (raw scipy):
    scipy.stats.wilcoxon([v - 100 for v in values])
    -> W = <FILL FROM STEP 2>, p = <FILL FROM STEP 2>
    median = <FILL FROM STEP 2>
"""
SCHEMA_OVERRIDES = {"sample": {"type": "categorical"}}

ANALYSES = [
    {
        "spec": {
            "spec_version": "2.0",
            "title": TITLE,
            "data": {"filter": []},
            "encodings": {"x": None, "y": {"column": "measure"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": "box", "params": {}}],
            "reduce": {"steps": []},
            "stats": {"alpha": 0.05, "family": "location", "reference_value": 100.0},
        },
        "expected_stats": {
            "test": "wilcoxon_signed",
            "per_group.0.n": 9,
            "per_group.0.W": (0.0, 1e-9),       # <-- replace 0.0 with recorded W
            "per_group.0.p": ("<", 0.05),       # tighten to recorded p bound
        },
        "expected_model": {"family": "location", "chosen_by": "inferred"},
        "expected_figure": {"axis_labels": {"y": "measure"}},
    },
]
```

> **Note on `stats`/`per_group` shape:** the exact spec keys that select the location family (`family`/`reference_value`) and the result paths (`per_group.0.W` etc.) must match the engine. Cross-check against the existing `engine/validation/cases/one-sample-location/case.py` and copy its `spec.stats` shape and `expected_stats` key paths verbatim, changing only the geom-irrelevant values. This guarantees the keys resolve.

- [ ] **Step 4: Build and validate**

Run (from `engine/`):
```bash
python -m validation.build one-sample-wilcoxon
python -m pytest validation/test_validation.py -k one_sample_wilcoxon -v
```
Expected: build prints `built one-sample-wilcoxon.iris  (+1 svg)`; pytest PASS. Correct literals to match the engine's real result if needed (per Task A1 Step 3 guidance).

- [ ] **Step 5: Commit**

```bash
git add engine/validation/cases/one-sample-wilcoxon
git commit -m "validation: add small-n one-sample Wilcoxon case"
```

---

### Task A3: Geom coverage on `iris-species-comparison` (`violin`/`bar`/`dot`/`summary`)

**Files:**
- Modify: `engine/validation/cases/iris-species-comparison/case.py:28-63`

Add four analyses rendering the *same* versicolor-vs-virginica comparison with the remaining group-comparison geoms. All infer the same Welch's t, so the `expected_stats` dict is shared; only `expected_figure` differs per geom. `dot` additionally sets `show_n` to cover the n-labels annotation.

- [ ] **Step 1: Factor the shared spec + stats, then add the four analyses**

Replace the `ANALYSES = [ ... ]` block (lines 28-63) with:

```python
_SPEC_BASE = {
    "spec_version": "2.0",
    "title": TITLE,
    "data": {"filter": []},
    "encodings": {"x": {"column": "species"},
                  "y": {"column": "petal_length"},
                  "color": None, "size": None, "shape": None},
    "reduce": {"steps": [
        {"kind": "filter",
         "conditions": [{"column": "species", "op": "in",
                         "value": ["versicolor", "virginica"]}]}]},
    "stats": {"alpha": 0.05},
}

# Welch's t is inferred identically regardless of geom, so every analysis shares
# this expectation; only the figure structure (below) changes per geom.
_WELCH_STATS = {
    "test": "welch_t",
    "t": (-12.603779, 1e-4),
    "df": (95.5704, 1e-2),
    "p": ("<", 1e-18),                  # p = 4.9e-22
    "mean_diff": (-1.292, 1e-6),
    "effect.value": (-2.501415, 1e-4),  # Hedges' g
    "summaries.0.n": 50,
    "summaries.1.n": 50,
    "summaries.0.mean": (4.26, 1e-9),
    "summaries.1.mean": (5.552, 1e-9),
}
_WELCH_MODEL = {"family": "group_comparison", "chosen_by": "inferred"}


def _analysis(geom, params, figure):
    return {
        "spec": {**_SPEC_BASE, "layers": [{"geom": geom, "params": params}]},
        "expected_stats": _WELCH_STATS,
        "expected_model": _WELCH_MODEL,
        "expected_figure": figure,
    }


ANALYSES = [
    _analysis("box", {}, {
        "axis_labels": {"y": "petal length"},
        "xtick_labels": ["versicolor", "virginica"],
        "point_groups": 0,                  # box only — no per-point marks
    }),
    _analysis("violin", {}, {
        "axis_labels": {"y": "petal length"},
        "xtick_labels": ["versicolor", "virginica"],
        "point_groups": 0,
    }),
    _analysis("bar", {}, {
        "axis_labels": {"y": "petal length"},
        "xtick_labels": ["versicolor", "virginica"],
        "point_groups": 0,
    }),
    _analysis("summary", {}, {
        "axis_labels": {"y": "petal length"},
        "xtick_labels": ["versicolor", "virginica"],
        "point_groups": 0,
    }),
    _analysis("dot", {"show_n": True}, {
        "axis_labels": {"y": "petal length"},
        "xtick_labels": ["versicolor", "virginica"],
        "point_groups": 2,                  # dot draws per-point marks per group
    }),
]
```

> **Note:** if `show_n` is a *style* knob rather than a layer `param` (check `engine/iris_engine/style.py` and how `one-sample-location` or another case sets it), move `{"show_n": True}` into `spec["style"]` instead of layer `params`. Verify against the engine; the build/validate step below will catch a wrong placement.

- [ ] **Step 2: Build and validate**

Run (from `engine/`):
```bash
python -m validation.build iris-species-comparison
python -m pytest validation/test_validation.py -k iris_species_comparison -v
```
Expected: build prints `built iris-species-comparison.iris  (+5 svg)`; pytest PASS (5 analyses). The validate harness asserts `len(saved) == len(ANALYSES)`, so a miscount fails loudly. Correct `point_groups`/`min_patches` literals to match real figure facts if the SVG structure differs (e.g. add `"min_patches": 1` for bar/violin if needed).

- [ ] **Step 3: Commit**

```bash
git add engine/validation/cases/iris-species-comparison/case.py
git commit -m "validation: render the species comparison across all group geoms"
```

---

## Phase B — Gallery exporter (engine)

### Task B1: `export_gallery.py` — bundle `.iris` + `.svg` + `manifest.json`

**Files:**
- Create: `engine/validation/export_gallery.py`
- Test: `engine/validation/test_export_gallery.py`

Reuses `harness.build_iris` for bytes and the `build.py` SVG-render pattern (`main._run` → `compiler.figure_to_svg`). Writes into the repo's `src/examples/assets/` (NOT the gitignored `artifacts/`), keyed so the frontend can resolve tokens.

- [ ] **Step 1: Write the failing round-trip test**

`engine/validation/test_export_gallery.py`:

```python
"""The bundled gallery assets must stay openable: every .iris named in the
generated manifest round-trips through document.load_document, and every plot
SVG it lists exists on disk. Guards against a stale or partial export."""
from __future__ import annotations

import json

from iris_engine import document

from . import export_gallery


def test_manifest_assets_round_trip():
    export_gallery.export(write=True)
    manifest = json.loads((export_gallery.ASSETS / "manifest.json").read_text())
    assert manifest, "manifest is empty"
    for entry in manifest:
        iris_path = export_gallery.ASSETS / entry["irisFile"]
        assert iris_path.exists(), f"missing {entry['irisFile']}"
        doc = document.load_document(iris_path.read_bytes())   # raises if corrupt
        assert doc["analyses"], f"{entry['caseId']} has no analyses"
        for plot in entry["plots"]:
            assert (export_gallery.ASSETS / plot["svgFile"]).exists(), \
                f"missing {plot['svgFile']}"
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `engine/`):
```bash
python -m pytest validation/test_export_gallery.py -v
```
Expected: FAIL — `ModuleNotFoundError: ...export_gallery` (not written yet).

- [ ] **Step 3: Write the exporter**

`engine/validation/export_gallery.py`:

```python
"""Export the curated gallery cases to the frontend bundle: an openable .iris and
one .svg per analysis for each case, plus a manifest.json the gallery UI reads.

    python -m validation.export_gallery

Unlike build.py (which writes the gitignored artifacts/ dir for spot-checking),
this writes COMMITTED assets under src/examples/assets/ so they ship with the
app and the frontend build stays pure-JS.
"""
from __future__ import annotations

import json
from pathlib import Path

from iris_engine import compiler, document, main

from . import harness

# repo_root/src/examples/assets  (this file is repo_root/engine/validation/...)
ASSETS = harness.ROOT.parent.parent / "src" / "examples" / "assets"

# Curated, ordered. Each entry is a case folder name; the gallery.md prose
# references plots as example:<caseId>/<analysisId>. Order here is documentary
# only — gallery.md controls display order.
GALLERY_CASES = [
    # Part I geom coverage + Part II two-group (parametric) live on this case:
    "iris-species-comparison",
    "mann-whitney",
    "sleep-paired-t",
    "sleep-wilcoxon",
    "iris-species-anova",
    "kruskal",
    "one-sample-location",
    "one-sample-wilcoxon",
    "iris-petal-correlation",
    "iris-petal-spearman",
    "contingency-2x2",
    "fisher-exact-tea",
    "iris-sepal-descriptive",
    "timeseries-growth",
]


def _export_case(case_name: str) -> dict:
    case = harness.load_case(harness.CASES_DIR / case_name)
    data = harness.build_iris(case, write=False)
    (ASSETS / f"{case_name}.iris").write_bytes(data)

    doc = document.load_document(data)
    table = {"schema": doc["schema"], "rows": doc["rows"]}
    plots = []
    for spec in doc["analyses"]:
        analysis_id = spec.get("id") or case_name
        fig, *_ = main._run(table, spec)
        svg = compiler.figure_to_svg(fig)
        compiler.close(fig)
        svg_file = f"{analysis_id}.svg"
        (ASSETS / svg_file).write_text(svg)
        geom = (spec.get("layers") or [{}])[0].get("geom", "")
        plots.append({"analysisId": analysis_id, "svgFile": svg_file, "geom": geom})

    return {
        "caseId": case_name,
        "title": getattr(case, "TITLE", case_name),
        "source": getattr(case, "SOURCE", ""),
        "irisFile": f"{case_name}.iris",
        "filename": f"{case_name}.iris",
        "plots": plots,
    }


def export(*, write: bool = True) -> list[dict]:
    ASSETS.mkdir(parents=True, exist_ok=True)
    manifest = [_export_case(name) for name in GALLERY_CASES]
    if write:
        (ASSETS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    m = export(write=True)
    print(f"exported {len(m)} cases "
          f"({sum(len(e['plots']) for e in m)} plots) -> {ASSETS}")
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `engine/`):
```bash
python -m pytest validation/test_export_gallery.py -v
```
Expected: PASS. Then sanity-check the output:
```bash
python -m validation.export_gallery
ls ../src/examples/assets | head
```
Expected: prints `exported 14 cases (... plots) -> .../src/examples/assets`; directory contains `manifest.json`, the `*.iris`, and `*.svg` files.

- [ ] **Step 5: Commit (including the generated assets)**

```bash
git add engine/validation/export_gallery.py engine/validation/test_export_gallery.py src/examples/assets
git commit -m "validation: add gallery exporter + bundle committed assets"
```

---

## Phase C — Frontend

### Task C1: Add `react-markdown` + `examples:build` script

**Files:**
- Modify: `package.json:13-30` (deps + scripts)

- [ ] **Step 1: Install the dependency**

Run (repo root):
```bash
npm install react-markdown@^9
```
Expected: `package.json` `dependencies` gains `"react-markdown": "^9..."`; lockfile updates.

- [ ] **Step 2: Add the examples build script**

Edit `package.json` `scripts` to add (after `"test"`):
```json
    "examples:build": "cd engine && python -m validation.export_gallery"
```

- [ ] **Step 3: Verify the script runs**

Run (repo root, engine venv active):
```bash
npm run examples:build
```
Expected: prints `exported 14 cases ...`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add react-markdown dep and examples:build script"
```

---

### Task C2: Token parsers (pure, unit-tested)

**Files:**
- Create: `src/examples/tokens.ts`
- Test: `src/examples/tokens.test.ts`

The `example:` (inline plot) and `iris-open:` (open action) URL schemes are parsed by pure functions so the resolution logic is tested without a DOM.

- [ ] **Step 1: Write the failing test**

`src/examples/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseExampleToken, parseOpenToken } from "./tokens";

describe("parseExampleToken", () => {
  it("parses a plot token into case + analysis ids", () => {
    expect(parseExampleToken("example:iris-species-comparison/iris-species-comparison-02"))
      .toEqual({ caseId: "iris-species-comparison", analysisId: "iris-species-comparison-02" });
  });
  it("returns null for a non-example src", () => {
    expect(parseExampleToken("https://example.com/x.png")).toBeNull();
  });
  it("returns null when the analysis id is missing", () => {
    expect(parseExampleToken("example:iris-species-comparison")).toBeNull();
  });
});

describe("parseOpenToken", () => {
  it("parses an open token into a case id", () => {
    expect(parseOpenToken("iris-open:timeseries-growth")).toEqual({ caseId: "timeseries-growth" });
  });
  it("returns null for an ordinary link", () => {
    expect(parseOpenToken("https://docs.example.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (repo root):
```bash
npx vitest run src/examples/tokens.test.ts
```
Expected: FAIL — cannot resolve `./tokens`.

- [ ] **Step 3: Write the parsers**

`src/examples/tokens.ts`:

```ts
/* The gallery markdown carries two custom URL schemes that react-markdown hands
   to our img/a overrides:
     ![](example:<caseId>/<analysisId>)   -> inline plot SVG
     [Open in Iris](iris-open:<caseId>)   -> Open-in-session action
   These pure parsers keep the resolution logic DOM-free and testable. */

export interface ExampleRef { caseId: string; analysisId: string; }
export interface OpenRef { caseId: string; }

export function parseExampleToken(src: string | undefined): ExampleRef | null {
  if (!src || !src.startsWith("example:")) return null;
  const rest = src.slice("example:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { caseId: rest.slice(0, slash), analysisId: rest.slice(slash + 1) };
}

export function parseOpenToken(href: string | undefined): OpenRef | null {
  if (!href || !href.startsWith("iris-open:")) return null;
  const caseId = href.slice("iris-open:".length);
  return caseId ? { caseId } : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/examples/tokens.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/examples/tokens.ts src/examples/tokens.test.ts
git commit -m "examples: add pure token parsers for gallery markdown"
```

---

### Task C3: `ExamplesGallery` component

**Files:**
- Create: `src/examples/ExamplesGallery.tsx`

Renders `gallery.md` with `react-markdown`. Vite glob-imports the bundled SVGs as raw text (inline `<svg>`) and exposes a callback for Open actions. The component is presentational: the actual load happens in `App.tsx` (Task C4), passed in as `onOpen`.

- [ ] **Step 1: Write the component**

`src/examples/ExamplesGallery.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import galleryMd from "./gallery.md?raw";
import { parseExampleToken, parseOpenToken } from "./tokens";

/* Bundled, committed assets (Task B1). Glob-import so adding a case needs no
   manual import list. SVGs come in as raw markup for crisp inline rendering;
   .iris files as URLs the opener fetches. */
const SVGS = import.meta.glob("./assets/*.svg", {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

const svgByAnalysis = (analysisId: string): string | undefined =>
  SVGS[`./assets/${analysisId}.svg`];

export function ExamplesGallery({ onOpen }: { onOpen: (caseId: string) => void }) {
  return (
    <div className="gallery">
      <div className="gallery-prose">
        <ReactMarkdown
          /* Our example:/iris-open: schemes are not http(s); the default
             url sanitizer would strip them. Content is authored in-repo, so
             pass URLs through untouched. */
          urlTransform={(url) => url}
          components={{
            img(props) {
              const ref = parseExampleToken(props.src);
              if (!ref) return <img {...props} />;
              const svg = svgByAnalysis(ref.analysisId);
              if (!svg)
                return <span className="gallery-missing">⚠ unknown example
                  "{ref.caseId}/{ref.analysisId}"</span>;
              return (
                <figure className="gallery-figure"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: svg }} />
              );
            },
            a(props) {
              const ref = parseOpenToken(props.href);
              if (!ref) return <a {...props} />;
              return (
                <button className="gallery-open-btn" type="button"
                  onClick={() => onOpen(ref.caseId)}>
                  {props.children}
                </button>
              );
            },
          }}
        >
          {galleryMd}
        </ReactMarkdown>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a TypeScript module declaration for `?raw` markdown (if needed)**

If `tsc` errors on `./gallery.md?raw`, create `src/examples/markdown.d.ts`:

```ts
declare module "*.md?raw" {
  const content: string;
  export default content;
}
```

- [ ] **Step 3: Type-check**

Run (repo root):
```bash
npx tsc --noEmit
```
Expected: no errors referencing `ExamplesGallery.tsx` (a missing `gallery.md` is fine for now if you create a stub; the next task authors it). If `gallery.md` does not exist yet, create a one-line stub `# Examples` so the import resolves, to be replaced in Task C6.

- [ ] **Step 4: Commit**

```bash
git add src/examples/ExamplesGallery.tsx src/examples/markdown.d.ts
git commit -m "examples: add ExamplesGallery markdown renderer"
```

---

### Task C4: Wire the Examples view + Open-in-Iris + save guard into `App.tsx`

**Files:**
- Modify: `src/state.ts:191`
- Modify: `src/App.tsx` (imports, `handleOpenExample`, `doSave` guard, toggle button, main render)

- [ ] **Step 1: Extend the view-mode union**

In `src/state.ts:191`, change:
```ts
export const viewModeAtom = atom<"data" | "analyses">("data");
```
to:
```ts
export const viewModeAtom = atom<"data" | "analyses" | "examples">("data");
```

- [ ] **Step 2: Import the gallery + asset URLs in `App.tsx`**

In `src/App.tsx`, add after the existing component imports (near line 11):
```tsx
import { ExamplesGallery } from "./examples/ExamplesGallery";
import exampleManifest from "./examples/assets/manifest.json";
```
And add a glob import for the `.iris` URLs after the imports block (near line 22):
```tsx
const EXAMPLE_IRIS = import.meta.glob("./examples/assets/*.iris", {
  query: "?url", import: "default", eager: true,
}) as Record<string, string>;
```

- [ ] **Step 3: Add the `handleOpenExample` handler**

In `App.tsx`, add alongside `doLoad` (after line 334). It mirrors `doLoad` but fetches a bundled asset and — critically — clears `fileHandleRef` so the next Save is a Save-As that cannot overwrite the bundled original:

```tsx
  /* Open a bundled example into the current session. Unlike doLoad there is no
     OS file handle, and we explicitly clear any retained one, so the next Save
     prompts for a location (Save As) — the shipped example is never overwritten
     in place. */
  const handleOpenExample = async (caseId: string) => {
    try {
      const url = EXAMPLE_IRIS[`./examples/assets/${caseId}.iris`];
      if (!url) throw new Error(`example "${caseId}" is not bundled`);
      const buf = await (await fetch(url)).arrayBuffer();
      const doc = await engine.loadDocument(fileToBase64(buf));
      loadDocument({
        schema: doc.schema, rows: doc.rows,
        analyses: doc.analyses.map(migrateSpec),
        id: doc.id, n: doc.n, version: doc.version, counts: doc.counts,
      });
      fileHandleRef.current = null;                 // force Save -> Save As
      setViewMode(doc.analyses.length ? "analyses" : "data");
    } catch (e) { surfaceUnlessAbort(e); }
  };
```

- [ ] **Step 4: Add the overwrite guard to `doSave`**

The set of bundled example filenames, derived from the manifest:
```tsx
  const exampleFilenames = new Set(
    (exampleManifest as { filename: string }[]).map((e) => e.filename));
```
Add this near the other derived constants (e.g. just after `IRIS_FILE_TYPES`, line 266).

Then modify `doSave` (lines 288-301): after a file is picked but before writing, warn if its name matches a shipped example. Replace the body of `doSave` with:

```tsx
  const doSave = async () => {
    if (!schema || allSpecs.length === 0 || !handle) return;
    try {
      if (!hasFsAccess()) return void await downloadIris();
      const bound = fileHandleRef.current;
      // Reuse the handle only if it belongs to the table we're looking at;
      // otherwise the first Save is really a Save As (pick a file).
      let fh = bound && bound.tableId === handle.id ? bound.fh : null;
      if (!fh)
        fh = await window.showSaveFilePicker({ suggestedName: "document.iris", types: IRIS_FILE_TYPES });
      // Guard the shipped examples: writing over one makes the Examples gallery
      // documentation no longer match the file it links to.
      if (exampleFilenames.has(fh.name) &&
          !window.confirm(`“${fh.name}” is an example file that ships with Iris. `
            + `Overwriting it means the Examples documentation will no longer `
            + `match this file. Save anyway?`))
        return;
      await writeIris(fh);
      fileHandleRef.current = { fh, tableId: handle.id };
    } catch (e) { surfaceUnlessAbort(e); }
  };
```

- [ ] **Step 5: Add the Examples toggle button**

In the `mode-toggle` div (lines 355-358), add a third button after the Analyses button:
```tsx
          <button className={viewMode === "examples" ? "active" : ""} onClick={() => setViewMode("examples")}>Examples</button>
```

- [ ] **Step 6: Render the gallery in `main`**

In the `<main>` render (lines 377-400), add an Examples branch as the FIRST condition so it shows regardless of whether data is loaded:
```tsx
      <main>
        {viewMode === "examples" ? (
          <div className="examples-mode"><ExamplesGallery onOpen={handleOpenExample} /></div>
        ) : viewMode === "data" ? (
          <div className="data-mode"><HierarchyPanel /><DataTable /></div>
        ) : dataLoading ? (
```
(Leave the rest of the existing chain unchanged.)

- [ ] **Step 7: Type-check and build**

Run (repo root):
```bash
npx tsc --noEmit && npm run build
```
Expected: no type errors; build succeeds. (Resolving `manifest.json` requires `resolveJsonModule` — it is on by default in Vite's TS config; if `tsc` complains, confirm `"resolveJsonModule": true` in `tsconfig.json`.)

- [ ] **Step 8: Commit**

```bash
git add src/state.ts src/App.tsx
git commit -m "examples: add Examples view, Open-in-Iris, and save overwrite guard"
```

---

### Task C5: Gallery styles

**Files:**
- Modify: `src/index.css` (append)

- [ ] **Step 1: Append gallery styles**

Add to the end of `src/index.css`, using the existing palette variables (`--ink`, `--dim`, `--line`, `--panel`, `--accent`, `--bg`):

```css
/* Examples gallery: a readable long-form document with inline plots. */
.examples-mode { flex: 1; overflow: auto; background: var(--bg); }
.gallery { max-width: 820px; margin: 0 auto; padding: 32px 28px 80px; }
.gallery-prose { color: var(--ink); line-height: 1.6; }
.gallery-prose h1 { font-size: 1.9em; margin: 0 0 0.3em; }
.gallery-prose h2 { font-size: 1.35em; margin: 1.8em 0 0.4em; padding-top: 0.4em;
  border-top: 1px solid var(--line); }
.gallery-prose h3 { font-size: 1.1em; margin: 1.4em 0 0.3em; color: var(--dim); }
.gallery-prose table { border-collapse: collapse; width: 100%; margin: 1em 0;
  font-size: 0.92em; }
.gallery-prose th, .gallery-prose td { border: 1px solid var(--line);
  padding: 6px 10px; text-align: left; }
.gallery-prose th { background: var(--panel); }
.gallery-figure { margin: 1.2em 0; padding: 12px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 6px; text-align: center; }
.gallery-figure svg { max-width: 100%; height: auto; }
.gallery-open-btn { display: inline-block; margin: 0.4em 0; padding: 6px 14px;
  font: inherit; color: #fff; background: var(--accent); border: none;
  border-radius: 5px; cursor: pointer; }
.gallery-open-btn:hover { filter: brightness(1.08); }
.gallery-missing { display: inline-block; padding: 8px 12px; color: var(--warn);
  background: #fff7ed; border: 1px dashed var(--warn); border-radius: 5px; }
```

- [ ] **Step 2: Commit**

```bash
git add src/index.css
git commit -m "examples: style the gallery document"
```

---

### Task C6: Author `gallery.md`

**Files:**
- Create/replace: `src/examples/gallery.md`

This is the authored content. It opens with the design × test × geom matrix, then **Part I** (one section per geom) and **Part II** (one section per experimental design, parametric + robust). Each example uses an `example:<caseId>/<analysisId>` plot token and an `[Open this example in Iris](iris-open:<caseId>)` action.

- [ ] **Step 1: Resolve the real analysis ids**

Analysis ids are `<caseId>-NN` (1-based, per `harness._analyses`). Confirm the exact ids and geoms per case:
```bash
cd engine && python -c "
import json, validation.export_gallery as g
for e in g.export(write=False):
    print(e['caseId'])
    for p in e['plots']:
        print('   ', p['analysisId'], p['geom'])
"
```
Use the printed `analysisId` values in the plot tokens below (the draft uses the expected `<caseId>-01` / `-02` … forms — correct them to match the printout).

- [ ] **Step 2: Write `gallery.md`**

Author the document. Pull each dataset's source/citation from the corresponding `case.py` `SOURCE`/`NOTES`. Draft content (correct analysis ids per Step 1):

````markdown
# Iris examples

A guided tour of every plot Iris can draw and every experimental design it can
analyse. Each example opens a real, citable dataset — click **Open this example
in Iris** to load it into the app and explore or adapt it. (Opened examples save
as a *new* file, so the originals stay intact.)

## At a glance

| Experimental design | Parametric | Robust / non-parametric | Typical plot |
|---|---|---|---|
| One sample vs a reference value | One-sample *t* | Wilcoxon signed-rank | box/dot + reference line |
| Two independent groups | Welch's *t* | Mann–Whitney *U* | box / violin |
| Two paired groups | Paired *t* | Wilcoxon signed-rank | box + connectors |
| Three+ independent groups | One-way ANOVA + Tukey | Kruskal–Wallis + Holm | box + brackets |
| Association of two numbers | Pearson *r* | Spearman *ρ* | scatter + regression |
| Two categorical variables | Chi-square | Fisher's exact (2×2) | heatmap |
| One distribution | *descriptive* | *descriptive* | histogram |
| A time course | *descriptive* | *descriptive* | line / trend |

---

# Part I — Plot types

Every mark in the grammar, with what it shows and when to reach for it.

## Box plot

The default for comparing a number across groups: median, quartiles, whiskers,
and outliers in one compact summary. Here, petal length for two iris species.

![](example:iris-species-comparison/iris-species-comparison-01)

[Open this example in Iris](iris-open:iris-species-comparison)

## Violin plot

A violin shows the full distribution shape (a mirrored kernel density), useful
when a box would hide bimodality or skew.

![](example:iris-species-comparison/iris-species-comparison-02)

[Open this example in Iris](iris-open:iris-species-comparison)

## Bar plot

Mean ± error. Familiar, but it hides the distribution — prefer box or dots when
you can.

![](example:iris-species-comparison/iris-species-comparison-03)

[Open this example in Iris](iris-open:iris-species-comparison)

## Summary (mean ± error)

The estimate and its uncertainty, without the bar's ink. Good for a clean
effect-size view.

![](example:iris-species-comparison/iris-species-comparison-04)

[Open this example in Iris](iris-open:iris-species-comparison)

## Dot plot

Every observation as a point — the most honest small-sample view. This example
also shows per-group **n labels**.

![](example:iris-species-comparison/iris-species-comparison-05)

[Open this example in Iris](iris-open:iris-species-comparison)

## Scatter + regression

Two numbers per observation, with an OLS fit and 95% confidence band. Here,
petal width against petal length.

![](example:iris-petal-correlation/iris-petal-correlation-01)

[Open this example in Iris](iris-open:iris-petal-correlation)

## Line (trajectories)

One curve per unit over an ordered x — orange-tree circumference at successive
ages, one line per tree.

![](example:timeseries-growth/timeseries-growth-01)

[Open this example in Iris](iris-open:timeseries-growth)

## Trend (mean ± band)

The average trajectory with a spread band, summarising many units into one
curve.

![](example:timeseries-growth/timeseries-growth-02)

[Open this example in Iris](iris-open:timeseries-growth)

## Histogram / distribution

The shape of a single variable. Sepal length across all 150 irises.

![](example:iris-sepal-descriptive/iris-sepal-descriptive-01)

[Open this example in Iris](iris-open:iris-sepal-descriptive)

## Heatmap / contingency tile

Counts for every combination of two categories — the natural picture of a
contingency table.

![](example:contingency-2x2/contingency-2x2-01)

[Open this example in Iris](iris-open:contingency-2x2)

---

# Part II — Experimental designs & their tests

For each design, the parametric default and the robust alternative Iris picks
when assumptions don't hold. Iris infers the test from the data; these examples
show what that inference produces.

## One sample vs a reference

**Parametric — one-sample *t*.** A single group tested against a fixed value,
with the reference drawn as a line.

![](example:one-sample-location/one-sample-location-01)

[Open this example in Iris](iris-open:one-sample-location)

**Robust — Wilcoxon signed-rank.** With a small sample, Iris switches to the
rank-based test automatically.

![](example:one-sample-wilcoxon/one-sample-wilcoxon-01)

[Open this example in Iris](iris-open:one-sample-wilcoxon)

## Two independent groups

**Parametric — Welch's *t*.** Two species' petal lengths, with a significance
bracket.

![](example:iris-species-comparison/iris-species-comparison-01)

[Open this example in Iris](iris-open:iris-species-comparison)

**Robust — Mann–Whitney *U*.** The rank-based two-group test.

![](example:mann-whitney/mann-whitney-01)

[Open this example in Iris](iris-open:mann-whitney)

## Two paired groups

**Parametric — paired *t*.** The classic Cushny–Peebles sleep data: each subject
measured under two conditions.

![](example:sleep-paired-t/sleep-paired-t-01)

[Open this example in Iris](iris-open:sleep-paired-t)

**Robust — Wilcoxon signed-rank.** The paired rank-based alternative on the same
data.

![](example:sleep-wilcoxon/sleep-wilcoxon-01)

[Open this example in Iris](iris-open:sleep-wilcoxon)

## Three or more independent groups

**Parametric — one-way ANOVA + Tukey HSD.** Petal length across all three iris
species, with post-hoc pairwise brackets.

![](example:iris-species-anova/iris-species-anova-01)

[Open this example in Iris](iris-open:iris-species-anova)

**Robust — Kruskal–Wallis + Holm.** The rank-based omnibus with Holm-corrected
pairwise comparisons.

![](example:kruskal/kruskal-01)

[Open this example in Iris](iris-open:kruskal)

## Association of two numeric variables

**Parametric — Pearson *r*.** Linear association of petal width and length.

![](example:iris-petal-correlation/iris-petal-correlation-01)

[Open this example in Iris](iris-open:iris-petal-correlation)

**Robust — Spearman *ρ*.** The rank correlation, robust to outliers and
monotone-but-nonlinear relationships.

![](example:iris-petal-spearman/iris-petal-spearman-01)

[Open this example in Iris](iris-open:iris-petal-spearman)

## Two categorical variables

**Parametric — chi-square.** Independence in a contingency table (aspirin and
myocardial infarction).

![](example:contingency-2x2/contingency-2x2-01)

[Open this example in Iris](iris-open:contingency-2x2)

**Robust — Fisher's exact.** The exact 2×2 test for small expected counts
(Fisher's lady-tasting-tea).

![](example:fisher-exact-tea/fisher-exact-tea-01)

[Open this example in Iris](iris-open:fisher-exact-tea)

## A distribution (descriptive)

Summary statistics and a histogram, no inferential test.

![](example:iris-sepal-descriptive/iris-sepal-descriptive-01)

[Open this example in Iris](iris-open:iris-sepal-descriptive)

## A time course (descriptive)

Trajectories over time. Iris describes the time course in this tier — it reports
timepoints and span and draws the curves, with no inferential test yet.

![](example:timeseries-growth/timeseries-growth-01)

[Open this example in Iris](iris-open:timeseries-growth)
````

- [ ] **Step 3: Verify rendering in the app**

Run the engine (`cd engine && python -m iris_engine.main`) and the dev server (`npm run dev`), open the app, click **Examples**. Confirm: the matrix table renders, plots appear inline (no `⚠ unknown example` placeholders), and headings/prose are styled. If any placeholder shows, fix the analysis id in the token to match Step 1's printout.

- [ ] **Step 4: Commit**

```bash
git add src/examples/gallery.md
git commit -m "examples: author the gallery document (plot types + designs)"
```

---

### Task C7: End-to-end test

**Files:**
- Create: `e2e/examples_test.mjs`

Mirrors the existing `e2e/save_load_test.mjs` style: standalone Playwright script, in-memory FS-Access stubs, needs engine (8765) + vite (5173). Verifies the Examples view renders, **Open in Iris** loads a document, and a subsequent Save is a Save-As (prompts for a file) — proving the original is protected.

- [ ] **Step 1: Write the e2e script**

`e2e/examples_test.mjs`:

```js
import { chromium } from "playwright";

/* E2E for the Examples gallery: switch to the view, confirm an inline plot
   renders, click "Open in Iris", and confirm the example loads into Analyses
   AND that the next Save is a Save As (showSaveFilePicker is called) — i.e. the
   shipped example is never bound as the write-back target.
   Needs the engine (8765) and the vite dev server (5173). */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

/* Stub the FS Access save picker so a later Save can't open a native dialog and
   so we can detect that Save fell through to "pick a file" (Save As). */
function installSavePickerStub() {
  let calls = 0;
  Object.defineProperty(window, "showSaveFilePicker", {
    configurable: true,
    value: async () => {
      window.__savePickerCalls = ++calls;
      const chunks = [];
      return {
        name: "untitled.iris",
        createWritable: async () => ({
          write: async (b) => chunks.push(b),
          close: async () => {},
        }),
      };
    },
  });
  window.__savePickerCalls = 0;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(installSavePickerStub);
await page.goto(URL);

// Switch to the Examples view.
await page.getByRole("button", { name: "Examples" }).click();

// An inline plot SVG must render (no unknown-example placeholders).
await page.waitForSelector(".gallery-figure svg", { timeout: 10_000 });
const missing = await page.locator(".gallery-missing").count();
if (missing > 0) fail(`${missing} unresolved example token(s) in gallery.md`);

// Open the first example into the session.
await page.locator(".gallery-open-btn").first().click();

// It should land in the Analyses view with a figure.
await page.getByRole("button", { name: "Analyses" })
  .waitFor({ state: "visible", timeout: 10_000 });
await page.waitForSelector(".analyses-mode .iris", { timeout: 15_000 });

// Saving now must call the save picker (Save As) — the example is not bound.
await page.getByRole("button", { name: "Save .iris" }).click();
await page.waitForFunction(() => window.__savePickerCalls > 0, { timeout: 10_000 })
  .catch(() => fail("Save did not prompt for a file — example may be bound as write target"));

console.log("PASS: examples gallery opens and saves as a new file");
await browser.close();
```

- [ ] **Step 2: Run the e2e test**

In separate terminals: `cd engine && python -m iris_engine.main` and `npm run dev`. Then:
```bash
node e2e/examples_test.mjs
```
Expected: `PASS: examples gallery opens and saves as a new file`. If the Open button's first match is a non-action link, adjust the selector; if Analyses isn't reached, check `handleOpenExample` set `viewMode`.

- [ ] **Step 3: Commit**

```bash
git add e2e/examples_test.mjs
git commit -m "examples: e2e for gallery view, open-in-iris, and save-as"
```

---

## Phase D — Verify the whole feature

### Task D1: Full verification pass

- [ ] **Step 1: Engine tests**

Run (from `engine/`):
```bash
python -m pytest validation/ -v
```
Expected: all validation cases (including the three new/extended ones) + `test_export_gallery` PASS.

- [ ] **Step 2: Frontend unit tests + build**

Run (repo root):
```bash
npm test && npm run build
```
Expected: vitest green (incl. `tokens.test.ts`); production build succeeds.

- [ ] **Step 3: Regenerate assets and confirm no drift**

Run:
```bash
npm run examples:build
git status --short src/examples/assets
```
Expected: no unexpected diff (assets already committed match a fresh export). If there's a diff, commit the regenerated assets.

- [ ] **Step 4: Manual smoke (the real app)**

Engine + `npm run dev`, open the app: Examples view renders the matrix and all inline plots; clicking several **Open in Iris** buttons loads each into Analyses; after opening, **Save .iris** prompts for a location (Save As); pick a filename matching a shipped example (e.g. `iris-species-comparison.iris`) and confirm the overwrite warning appears.

- [ ] **Step 5: Final commit (if anything changed)**

```bash
git add -A && git commit -m "examples: verification pass for the gallery feature"
```

---

## Self-Review notes (for the implementer)

- **Analysis ids:** `gallery.md` plot tokens MUST match the real `<caseId>-NN` ids printed in Task C6 Step 1. The draft uses the expected ordering (`-01` = box, `-02` = violin, …) but verify, since adding/reordering analyses shifts the numbers.
- **`show_n` placement (Task A3):** confirmed via the engine whether it's a layer `param` or a `style` key; the build/validate step is the gate.
- **Location-family spec shape (Task A2):** copy `spec.stats` and `expected_stats` key paths from `one-sample-location/case.py` so the family is selected and result paths resolve.
- **react-markdown URL schemes:** `urlTransform={(url) => url}` is required, or `example:`/`iris-open:` get stripped and every token silently fails.
- **Asset location:** `src/examples/assets/` (committed) — NOT `engine/validation/artifacts/` (gitignored). The exporter writes the former.
