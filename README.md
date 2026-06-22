# Iris

**Publication-grade figures and honest statistics for researchers who don't code.**

Iris is a desktop application built around one idea — the *reactive triad*: a
typed data table, a figure, and a statistical analysis, linked so that editing
any one updates the others instantly and honestly. You map columns to a plot,
optionally add a test, and Iris produces a matplotlib vector figure and a
citable statistic from the *same* declarative spec, so the plot and the test can
never disagree about the data.

The audience is the colleague who knows what an ANOVA is but not how to write
one — and whose p-values and figures will end up in a paper or thesis. The
promise is never having to re-make a figure in Prism or ggplot afterwards.

Three properties arbitrate every decision:

- **Power** — every inferential number comes from scipy, statsmodels, and
  pingouin. Battle-tested, citable code, never reimplemented.
- **Beauty** — every figure is matplotlib vector output with full typographic
  control. The on-screen preview and the exported PDF are the *same* renderer at
  the *same* physical size (millimetres, fonttype 42, editable text).
- **Simplicity** — a one-click installer for users, and an architecture a small
  team can maintain: boring at the edges, opinionated at the core.

All compute is local; your data never leaves the machine.

## Architecture

```
┌──────────────────────────┐   HTTP (localhost)   ┌──────────────────────────────┐
│  React + TypeScript       │ ───────────────────► │  iris-engine (Python sidecar) │
│  Jotai state · AG Grid     │   /analyze /export   │  pandas · scipy · pingouin    │
│  SVG injection             │ ◄─────────────────── │  matplotlib (vector SVG/PDF)  │
└──────────────────────────┘   SVG + stats + spec   └──────────────────────────────┘
        ▲ both hosted by the Tauri shell, which spawns and reaps the sidecar ▲
```

The keystone artifact is the **declarative analysis spec**: grammar-of-graphics
encodings, an ordered stack of geom layers, a data-`hierarchy` block, and a
stats clause. It compiles to *both* the plot and the test. The engine ships as a
pip-installable library (`iris-engine`) whose render/stats core needs no web
framework; FastAPI is an optional extra used only by the GUI. Documents are
`.iris` files — a ZIP of a Parquet table plus human-readable JSON (schema,
analysis specs, provenance).

## Quickstart (dev mode)

One command starts both halves; open http://localhost:5173 when it's ready:

```bash
pip install -e "engine[server]"   # engine + FastAPI service
npm install
./dev.sh                          # starts the engine, waits for /health, then Vite
```

Or run the two halves manually:

```bash
# Terminal 1 — engine
cd engine && python -m iris_engine.main          # serves on 127.0.0.1:8765

# Terminal 2 — frontend
npm run dev                                       # http://localhost:5173
```

The app opens on a sample dataset. Import a CSV/TSV/Excel file, map columns to a
plot, compose geom layers, optionally add a statistical test, restyle in
millimetres, export SVG/PDF/PNG, and save a `.iris` document.

To drop rows from an analysis, add a `filter` step to the reduction pipeline
(e.g. `flag == false`). A `.iris` is then a pure function of its input table and
its analysis spec — the judgment of *which* rows to keep lives in the spec,
where its provenance belongs.

## Using the engine without the GUI

`iris-engine` is an importable library: read an `.iris`, run the stats, and
render the figures from a script, no browser required.

```python
from iris_engine import compiler, document, stats   # no FastAPI needed
```

See [`engine/README.md`](engine/README.md) for the library and HTTP-service
surface.

## Desktop shell (Tauri)

Requires the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)
(Rust, plus webkit2gtk on Linux):

```bash
npm install
cargo install tauri-cli --version "^2"
cargo tauri dev        # spawns the engine via system python3; set IRIS_PYTHON to override
```

## Packaging

The engine freezes to a single sidecar binary that the shell bundles via
`bundle.externalBin` and spawns instead of system Python. `spawn_engine()` falls
back to system Python when no bundled binary sits next to the shell executable,
so dev mode is unchanged.

```bash
cd engine
pip install -r requirements-dev.txt
pyinstaller iris-engine.spec           # → dist/iris-engine
python tests/smoke_frozen.py           # protocol + lifecycle against the binary

# Tauri expects the sidecar named with the host target triple:
triple=$(rustc -vV | sed -n 's/host: //p')
mkdir -p ../src-tauri/binaries
cp dist/iris-engine "../src-tauri/binaries/iris-engine-$triple"

cd .. && npx tauri build               # installers in src-tauri/target/release/bundle/
```

Notes learned the hard way:

- `iris_engine/main.py` uses relative imports, so the spec freezes
  `freeze_entry.py`, not `main.py` directly.
- `freeze_runtime_hook.py` pins `MPLCONFIGDIR` to a per-user cache dir so
  matplotlib's first-launch font scan isn't repeated every launch.
- The shell picks a free port at runtime (8765 first) and the frontend asks for
  it via the `engine_port` Tauri command; dev mode keeps plain 8765.
- Installers are currently unsigned; signing/notarization is deferred (see
  [ROADMAP.md](ROADMAP.md)).

## What is validated

The engine carries a pytest suite (`engine/tests/`, 21 files) plus a per-family
**validation corpus** (`engine/validation/`) that asserts each statistical
family against reference values recomputed independently against raw scipy:

- Two-group (Welch's t / Mann–Whitney / paired-t / Wilcoxon), multi-group
  (one-way ANOVA + Tukey HSD / Kruskal–Wallis + Holm), correlation
  (Pearson/Spearman), and contingency (chi-square / Fisher's exact) match
  ground truth to four-plus decimals.
- Effect sizes (Hedges' g, rank-biserial, r/ρ, Cramér's V / odds ratio) are
  reported with CIs where defined.
- PDF export measures exact physical dimensions with editable text (fonttype 42).
- `.iris` documents round-trip losslessly.
- The frontend compiles under strict TypeScript and builds with Vite.

Why a validation suite is non-negotiable: pingouin 0.6 once silently renamed its
result columns and broke the engine. Engine dependency versions are pinned and
recorded in every document's `engine_snapshot`.

## Repo map

```
engine/iris_engine/
  document.py     .iris ZIP format (Parquet table + JSON parts) + sample data
  importer.py     CSV/TSV/Excel import: locale sniffing, type inference, wide→long
  session.py      server-owned table behind a session handle (id/version/schema)
  hierarchy.py    the data "spine": nested identifier levels + per-layer grain
  reduce.py       reduction pipeline (select + filter)
  specnorm.py     spec normalization + migration from older shapes
  compiler.py     spec → matplotlib figure (layered geoms, mm sizing, vector SVG)
  geoms.py        geom registry (drives the layer rail and guard pass)
  scales.py       shared aesthetic scales (color/size/shape, palettes)
  guards.py       guard pass (point cap, facet-cell cap, actionable messages)
  stats.py        pingouin/scipy orchestration + the guided test picker
  statmodel.py    encodings → inferred, overridable stat model
  style.py        style registry + override resolution (screen == export)
  render.py       FastAPI-free render core (build a figure/stats from a spec)
  main.py         optional FastAPI HTTP service

engine/tests/         pytest suite
engine/validation/    per-family reference corpus

src/
  state.ts            Jotai atoms, derived spec, analysis cache
  types.ts            spec schema types + protocol client
  channels.ts         encoding/geom compatibility logic
  hierarchy / levels  data-spine UI helpers
  components/         DataTable, FigurePane, StatsPanel, EncodingsCard,
                      LayerRail, StylePane, ImportWizard, GuidedTestPicker, …

src-tauri/            desktop shell (spawns/reaps the engine sidecar)
```

## Status & roadmap

Tier 2 — the credible-tool milestone — is mostly complete: the composable
grammar of graphics, the data-hierarchy model, and the guided test picker are
built and tested; what remains is breadth, polish, optimization, and real-world
use. See [ROADMAP.md](ROADMAP.md) for what's next.

## License

[AGPL-3.0](LICENSE).
