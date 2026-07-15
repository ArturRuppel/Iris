# Contributing to Iris

Iris is developed in the open, and contributions are welcome! This page covers
the three things people usually need: how to report a problem, how to get help,
and how to send a change.

Iris is early, so the most valuable contribution is a report of where it broke on
your real data.

## Report a bug or request a feature

Open an issue: <https://github.com/ArturRuppel/Iris/issues>

A useful bug report says what you did, what you expected, and what happened
instead. Include your operating system and the smallest input that reproduces the
problem.

The best attachment is the `.iris` document itself: it holds the data and the
full analysis spec, so it reproduces the state exactly rather than approximately.
It also holds your data. If that data is unpublished or sensitive, reproduce the
problem on a handful of invented rows and send that instead. A three-row table
that fails is worth more than a real one nobody can open.

If the app misbehaves rather than crashes, say which half you suspect: the engine
logs to the terminal that started it, and the frontend logs to the browser
console.

## Get help

For a usage question that is not clearly a bug, open an issue and label it
`question`. The [user guide](docs/guide/index.md) covers the common cases, and
[troubleshooting](docs/guide/troubleshooting.md) collects the ones that surprise
people. For questions about the statistics themselves, or about whether Iris
suits your analysis, contact Artur Ruppel at `artur@ruppel.pro`.

## Contribute a change

1. Fork the repository and branch from `main`.
2. Set up a development environment (below).
3. Make the change, with a test that fails before it and passes after.
4. Run the checks locally. Iris has no CI, so your machine is where they run.
5. Open a pull request describing what changed and why.

Keep pull requests focused: one concern per branch is easier to review and faster
to merge. For anything beyond a bug fix, open an issue first.
[ROADMAP.md](ROADMAP.md) says what is planned and what is deliberately deferred;
if something in the deferred list should not be, the issue is the place to say
so.

A few conventions worth knowing before you write code:

- The engine's render and stats core stays free of the web framework. FastAPI is
  an optional extra used only by the GUI; a core module that imports it is a
  layering break.
- Screen and export are the same renderer at the same physical size. A style path
  that only fixes the preview will diverge from the PDF, which is the artifact
  that matters.
- Iris has no installed base, so it carries no compatibility shims. If a design
  is wrong, replace it and delete the old path rather than deprecating it.
- Prose in `docs/` follows the house style: purpose before mechanism, concrete
  examples over abstractions, no em-dashes.

Iris is [AGPL-3.0](LICENSE), and contributions are accepted under the same
license. By opening a pull request you affirm you wrote the code, or that you
have the right to submit it under AGPL-3.0.

## Development setup

You need Python 3.10+ and Node 18+. Linux is the verified platform.

```bash
pip install -e "engine[server]"            # engine + FastAPI service
pip install -r engine/requirements-dev.txt # pytest, pyinstaller
npm install
./dev.sh                                   # engine + Vite, on :5173
```

Then run the checks:

```bash
cd engine && python -m pytest tests validation   # 630 tests: engine + validation corpus
npm test                                         # 539 frontend tests
npm run build                                    # strict TypeScript + production build
```

The end-to-end tests drive a real browser against a running dev stack, so start
one first:

```bash
npx playwright install chromium   # once
./dev.sh                          # in another terminal
node e2e/superplot_test.mjs       # any file in e2e/
```

If you touch the engine's statistics or its rendering, the validation corpus
(`engine/validation/`) is the one that matters. Read its
[README](engine/validation/README.md) before adding a case: each case asserts
against reference values recomputed independently with raw scipy, never against
Iris's own output. A case that checks Iris against itself looks like evidence
without being any.

That corpus exists because of what Iris promises its users. Its readers can read
a p-value but not audit the code behind it, so the numbers are taken on trust:
inference comes from scipy, statsmodels, and pingouin rather than from
hand-rolled code, and the plot and the test compile from one spec so they cannot
disagree. Changes that widen a test's reach are welcome as long as the assumption
checks and the effect size come along with it.

## Repo map

The engine is grouped by what each module is for: the document, the data spine,
the figure, and the statistics.

```
engine/iris_engine/
  the document    document.py (.iris ZIP: Parquet + schema + hierarchy per table),
                  importer.py (CSV/TSV/Excel, locale sniffing, wide→long),
                  session.py, build_info.py, autosave.py
  the data spine  hierarchy.py (nested identifier levels + per-layer grain),
                  reduce.py (filter/drop/derive/recode/join/pivot/grid_complete),
                  dag.py (the shaping graph), shape.py, specnorm.py
  the figure      compiler.py (spec → matplotlib, mm sizing, vector SVG),
                  geoms.py, scales.py, guards.py, style.py, render.py
  the statistics  stats.py (pingouin/scipy orchestration + the test picker),
                  statmodel.py, methods.py
  main.py         optional FastAPI HTTP service

engine/tests/         pytest suite (59 files, 600 tests)
engine/validation/    per-family reference corpus (27 cases)

src/
  state.ts            Jotai atoms, table pool, derived spec, analysis cache
  types.ts            spec schema types + protocol client
  channels.ts         encoding/geom compatibility logic
  collapse.ts         collapse-plan helpers (the grain spine)
  grouped.ts          the grouped-sheet lens over a nested table
  useGridSelection.ts shared spreadsheet selection/clipboard behaviour
  explorer/           graph.ts, the analysis → dataflow-graph derivation
  workbench/          WorkbenchCanvas + node/edge cards (the interactive DAG)
  components/         TableList, HierarchyPanel, DataTable, FigurePane, StatsPanel,
                      EncodingsCard, ImportWizard, GuidedTestPicker, …
  examples/           tutorial/           style/

e2e/                  Playwright smoke tests against a running dev stack
docs/guide/           the user guide
src-tauri/            desktop shell (spawns/reaps the engine sidecar)
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

Four things about this are easy to trip over:

- `iris_engine/main.py` uses relative imports, so the spec freezes
  `freeze_entry.py`, not `main.py` directly.
- `freeze_runtime_hook.py` pins `MPLCONFIGDIR` to a per-user cache dir so
  matplotlib's first-launch font scan isn't repeated every launch.
- The shell picks a free port at runtime (8765 first) and the frontend asks for
  it via the `engine_port` Tauri command; dev mode keeps plain 8765.
- Installers are currently unsigned; signing and notarization are deferred (see
  [ROADMAP.md](ROADMAP.md)).

## Code of conduct

Be respectful and constructive. Assume good faith, keep discussion on the
technical merits, and make this a project people are glad to take part in. Report
conduct concerns to `artur@ruppel.pro`.
