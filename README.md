# Iris

**Publication-grade figures and honest statistics for researchers who don't code.**

Iris is a desktop application built around one idea, the *reactive triad*: a
typed data table, a figure, and a statistical analysis, linked so that editing
any one updates the others instantly and honestly. You build each analysis on an
interactive graph, the **workbench**, where the input tables, the shaping steps,
the figure, and the test are nodes you click to edit. Iris renders a matplotlib
vector figure and computes a citable statistic from the *same* declarative spec,
so the plot and the test can never disagree about the data.

The audience is the colleague who knows what an ANOVA is but not how to write
one, and whose p-values and figures will end up in a paper or thesis. The
promise is never having to re-make a figure in Prism or ggplot afterwards.

Three properties arbitrate every decision:

- **Power**: every inferential number comes from scipy, statsmodels, and
  pingouin. Battle-tested, citable code, never reimplemented.
- **Beauty**: every figure is matplotlib vector output with full typographic
  control. The on-screen preview and the exported PDF are the same renderer at
  the same physical size (millimetres, fonttype 42, editable text).
- **Simplicity**: a one-click installer for users, and an architecture a small
  team can maintain: boring at the edges, opinionated at the core.

All compute is local; your data never leaves the machine.

## Status

Iris is under **active development** and has no tagged release. It is useful
today and it is not finished.

What works end-to-end: import one or more tables, reshape them on the
transformation workbench, compose a figure from a stack of geom layers, add a
guided statistical test, restyle in millimetres, export a PDF, and save a
`.iris` document. The four load-bearing systems (the grammar of graphics, the
data-hierarchy model, the guided test picker, and the workbench) are built and
tested. What remains is breadth, polish, and real-world use. See
[ROADMAP.md](ROADMAP.md).

Three things to know before you rely on it:

- **Linux is the verified platform.** Development and testing happen there. The
  Tauri shell is cross-platform by construction, but macOS and Windows builds
  are neither packaged nor verified yet, and installers are unsigned.
  Cross-platform distribution is a roadmap item.
- **Interfaces are not frozen.** Iris has no installed base, so a breaking
  change lands when it is the right call, without a deprecation cycle. The
  `.iris` format is versioned (currently 2.1) and still moving.
- **The statistics are validated; the surface around them is younger.** Every
  test family is checked against independently recomputed scipy reference values
  (see [What is validated](#what-is-validated)). Bugs, when they come, are far
  likelier in the UI than in the numbers.

## Why Iris exists

Tools that turn data into a publication figure and a defensible statistic tend
to offer one way in or the other: a point-and-click interface, approachable but
closed to scripting, or a code library, scriptable but closed to anyone who
doesn't program. A researcher who starts in one is stuck there: the work can't
later be automated, and an analysis produced by a pipeline can't be opened up
and adjusted by hand.

Iris is built around a single declarative document that is equally at home in
both. A pipeline can generate a batch of analyses; a researcher can finish them
in the GUI; the file reads back into code unchanged. The artifact is data, not
executable code, so it stays safe to share and re-render, and the figure and the
statistic always come from the same spec.

To our knowledge no existing tool, and in particular no open-source one, brings
these together: publication-grade vector figures, validated and citable
statistics, produced and edited from either code or a GUI, with all computation
local. Each piece exists somewhere; the combination, as far as we know, does
not. That gap is the reason Iris is being built.

## Documentation

The user guide lives in [`docs/guide/`](docs/guide/index.md). Start with the
[quickstart](docs/guide/quickstart.md), which walks one dataset from import to
exported figure. From there the guide follows the same path in depth:
[getting data in](docs/guide/data-in.md),
[shaping it](docs/guide/shape.md),
[nesting](docs/guide/nesting.md),
[reshaping](docs/guide/reshaping.md),
[plots](docs/guide/plots.md),
[choosing a test](docs/guide/test/choosing.md),
[interpreting the result](docs/guide/test/interpreting.md), and
[troubleshooting](docs/guide/troubleshooting.md).

The reference pages document the
[`.iris` format](docs/guide/reference/iris-format.md), the
[composition rules](docs/guide/reference/composition.md), and
[what to cite](docs/guide/reference/citations.md) when an Iris analysis ends up
in a paper.

## Architecture

```
┌────────────────────────────┐  HTTP (localhost)  ┌───────────────────────────────┐
│  React + TypeScript        │ ─────────────────► │  iris-engine (Python sidecar) │
│  Jotai state · AG Grid     │  /analyze /export  │  pandas · scipy · pingouin    │
│  SVG injection             │ ◄───────────────── │  matplotlib (vector SVG/PDF)  │
└────────────────────────────┘  SVG + stats + spec└───────────────────────────────┘
       ▲ both hosted by the Tauri shell, which spawns and reaps the sidecar ▲
```

The keystone artifact is the **declarative analysis spec**: grammar-of-graphics
encodings, an ordered stack of geom layers, a reduction pipeline of shaping steps
(filter, drop, derive, recode, join, pivot, grid_complete) over a chosen main
table, a data-`hierarchy` block, and a stats clause. It compiles to *both* the
plot and the test.

The engine ships as a pip-installable library (`iris-engine`) whose render and
stats core needs no web framework; FastAPI is an optional extra used only by the
GUI. Documents are `.iris` files: a ZIP holding one Parquet table per named
input table (each with its own schema and hierarchy), plus human-readable JSON
for the analysis specs, provenance, and an engine-identity manifest.

## Quickstart (dev mode)

You need Python 3.10+ and Node 18+. One command starts both halves; open
http://localhost:5173 when it's ready:

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
(for example `flag == false`). A `.iris` is then a pure function of its input
table and its analysis spec: the judgment of *which* rows to keep lives in the
spec, where its provenance belongs.

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
- Installers are currently unsigned; signing and notarization are deferred (see
  [ROADMAP.md](ROADMAP.md)).

## What is validated

The engine carries a pytest suite (`engine/tests/`, 58 files) plus a per-family
**validation corpus** (`engine/validation/`, 27 cases) that asserts each
statistical family against reference values recomputed independently against raw
scipy:

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
  document.py     .iris ZIP format (multi-table: one Parquet + schema + hierarchy
                  per named table) + engine-identity manifest + sample data
  importer.py     CSV/TSV/Excel import: locale sniffing, type inference, wide→long
  session.py      server-owned table behind a session handle (id/version/schema)
  hierarchy.py    the data "spine": nested identifier levels + per-layer grain
  reduce.py       the shaping pipeline: filter/drop/derive/recode/join/pivot/
                  grid_complete, plus the post-collapse (reduce.post) phase
  dag.py          the shaping graph: fan-out/fan-in over the reduction steps
  shape.py        array-shape descriptor for a table (drives the workbench nodes)
  specnorm.py     spec normalization + migration from older shapes
  compiler.py     spec → matplotlib figure (layered geoms, mm sizing, vector SVG)
  geoms.py        geom registry (drives the layer rail and guard pass)
  scales.py       shared aesthetic scales (color/size/shape, palettes)
  guards.py       guard pass (point cap, facet-cell cap, actionable messages)
  stats.py        pingouin/scipy orchestration + the guided test picker
  statmodel.py    encodings → inferred, overridable stat model
  methods.py      generated methods text for the chosen test
  style.py        style registry + override resolution (screen == export)
  render.py       FastAPI-free render core (build a figure/stats from a spec)
  autosave.py     crash-recovery snapshots of the working document
  build_info.py   engine version/commit identity stamped into every document
  main.py         optional FastAPI HTTP service

engine/tests/         pytest suite (58 files, 598 tests)
engine/validation/    per-family reference corpus (27 cases)

src/
  state.ts            Jotai atoms, table pool, derived spec, analysis cache
  types.ts            spec schema types + protocol client
  channels.ts         encoding/geom compatibility logic
  collapse.ts         collapse-plan helpers (the grain spine)
  tables.ts / levels.ts   table-pool + data-spine UI helpers
  grouped.ts          the grouped-sheet lens over a nested table
  useGridSelection.ts shared spreadsheet selection/clipboard behaviour
  explorer/           graph.ts — the analysis → dataflow-graph derivation
  workbench/          WorkbenchCanvas + node/edge cards (the interactive DAG)
  components/         TableList, HierarchyPanel, DataTable, FigurePane, StatsPanel,
                      EncodingsCard, ImportWizard, GuidedTestPicker, …
  examples/           the built-in example gallery (.iris assets)
  tutorial/           the in-app interactive tutorial
  style/              style-sheet UI helpers

e2e/                  Playwright smoke tests against a running dev stack
docs/guide/           the user guide
src-tauri/            desktop shell (spawns/reaps the engine sidecar)
```

## Contributing

Iris is early, so the most valuable contribution is telling us where it breaks
on your real data. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the
tests and what the house rules are.

## License

[AGPL-3.0](LICENSE).
