# Iris

Publication-grade figures and honest statistics, from the GUI, from code, or both.

Iris is a desktop application built around one idea, the *reactive triad*: a
typed data table, a figure, and a statistical analysis, linked so that editing
any one updates the others. You build each analysis on an interactive graph, the
**workbench**, where the input tables, the shaping steps, the figure, and the
test are nodes you click to edit. Iris renders a matplotlib vector figure and
computes a statistic from the same declarative spec, so the plot and the test
cannot disagree about the data.

Neither way in is an afterthought. The slow part of a figure is rarely the
statistics: it is the long tail of small visual decisions, and pointing at one
beats editing a parameter and re-running. That is what the GUI is for. Batching,
diffing, and reproducing a result a year later are what code is for.

An analysis is a file, not a script. A `.iris` holds your data together with the
specification of the analysis: the steps that shape the table, the plot, and the
test. A script can generate a hundred of them; you can open any one, fix the
figure by hand, and save; the script reads the result back unchanged. Neither
half is mandatory. The GUI alone takes a table from import to exported figure.

## Status

Iris is under active development and has no tagged release. Import, shaping,
figure composition, the guided test picker, and `.iris` save/load work end to
end and are covered by tests, but Iris has not yet been used for a published
analysis: handing it to the researchers it is for is the next milestone, and the
one most likely to change it. Linux is the verified platform: the Tauri shell is
cross-platform by construction, but macOS and Windows builds are not packaged or
verified yet, and installers are unsigned. Interfaces are still moving, and the
`.iris` format (currently 2.1) moves with them. See [ROADMAP.md](ROADMAP.md).

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
[composition rules](docs/guide/reference/composition.md), and the
[published methods](docs/guide/reference/citations.md) behind Iris's statistical
recommendations.

## Architecture

```
┌────────────────────────────┐  HTTP (localhost)  ┌───────────────────────────────┐
│  React + TypeScript        │ ─────────────────► │  iris-engine (Python sidecar) │
│  Jotai state · AG Grid     │  /analyze /export  │  pandas · scipy · pingouin    │
│  SVG injection             │ ◄───────────────── │  matplotlib (vector SVG/PDF)  │
└────────────────────────────┘  SVG + stats + spec└───────────────────────────────┘
       ▲ both hosted by the Tauri shell, which spawns and reaps the sidecar ▲
```

The keystone artifact is the declarative analysis spec: grammar-of-graphics
encodings, an ordered stack of geom layers, a reduction pipeline of shaping steps
(filter, drop, derive, recode, join, pivot, grid_complete) over a chosen main
table, a data-`hierarchy` block, and a stats clause. It compiles to both the plot
and the test.

The engine ships as a pip-installable library (`iris-engine`) whose render and
stats core needs no web framework; FastAPI is an optional extra used only by the
GUI. Documents are `.iris` files: a ZIP holding one Parquet table per named input
table (each with its own schema and hierarchy), plus human-readable JSON for the
analysis specs, provenance, and an engine-identity manifest.

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
# Terminal 1: engine
cd engine && python -m iris_engine.main          # serves on 127.0.0.1:8765

# Terminal 2: frontend
npm run dev                                       # http://localhost:5173
```

There is a third way to run it, used on the author's machine. `--serve` makes the
engine hand out the built frontend from its own origin, as one long-running
service on a private network — which is how Iris reaches a tablet, over HTTPS via
`tailscale serve`, with a shell-only service worker so an unreachable server shows
Iris saying so rather than a browser error. It is a deployment note rather than a
supported product, and the layout is still a desktop layout. See
[docs/serving.md](docs/serving.md).

The app opens on a sample dataset. Import a CSV/TSV/Excel file, map columns to a
plot, compose geom layers, optionally add a statistical test, restyle in
millimetres, export SVG/PDF/PNG, and save a `.iris` document.

To drop rows from an analysis, add a `filter` step to the reduction pipeline
(for example `flag == false`). A `.iris` is then a pure function of its input
table and its analysis spec: the judgment of which rows to keep lives in the
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

## What is validated

The engine carries a pytest suite (`engine/tests/`, 59 files, 600 tests) plus a
per-family validation corpus (`engine/validation/`, 27 cases) that asserts each
statistical family against reference values recomputed independently against raw
scipy. Together, `python -m pytest tests validation` from `engine/` runs 630
tests.

- Two-group (Welch's t / Mann–Whitney / paired-t / Wilcoxon), multi-group
  (one-way ANOVA + Tukey HSD / Kruskal–Wallis + Holm), correlation
  (Pearson/Spearman), and contingency (chi-square / Fisher's exact) match
  ground truth to four-plus decimals.
- Effect sizes (Hedges' g, rank-biserial, r/ρ, Cramér's V / odds ratio) are
  reported with CIs where defined.
- PDF export measures exact physical dimensions with editable text (fonttype 42).
- `.iris` documents round-trip losslessly.
- The frontend carries 539 tests in 50 files (`npm test`) and compiles under
  strict TypeScript (`npm run build`).

Engine dependency versions are pinned and recorded in every document's
`engine_snapshot`. The corpus earns its keep: pingouin 0.6 once silently renamed
its result columns and broke the engine.

## Built on

Iris does not implement statistics. Every inferential number comes from an
established library, and every figure from matplotlib. If you publish an Iris
analysis, please cite the ones it used:

- **[scipy](https://scipy.org)**: Virtanen P, et al. *SciPy 1.0: fundamental
  algorithms for scientific computing in Python.* Nature Methods 17, 261–272
  (2020). [doi:10.1038/s41592-019-0686-2](https://doi.org/10.1038/s41592-019-0686-2)
- **[statsmodels](https://www.statsmodels.org)**: Seabold S, Perktold J.
  *statsmodels: econometric and statistical modeling with Python.* Proceedings of
  the 9th Python in Science Conference (2010).
  [doi:10.25080/Majora-92bf1922-011](https://doi.org/10.25080/Majora-92bf1922-011)
- **[pingouin](https://pingouin-stats.org)**: Vallat R. *Pingouin: statistics in
  Python.* Journal of Open Source Software 3(31), 1026 (2018).
  [doi:10.21105/joss.01026](https://doi.org/10.21105/joss.01026)
- **[matplotlib](https://matplotlib.org)**: Hunter JD. *Matplotlib: a 2D graphics
  environment.* Computing in Science & Engineering 9(3), 90–95 (2007).
  [doi:10.1109/MCSE.2007.55](https://doi.org/10.1109/MCSE.2007.55)
- **[pandas](https://pandas.pydata.org)**: McKinney W. *Data structures for
  statistical computing in Python.* Proceedings of the 9th Python in Science
  Conference (2010). [doi:10.25080/Majora-92bf1922-00a](https://doi.org/10.25080/Majora-92bf1922-00a)

The methods behind Iris's test recommendations are cited in
[`docs/guide/reference/citations.md`](docs/guide/reference/citations.md).

## Contributing and support

Bug reports, questions, and pull requests are welcome. Iris is early, so the most
valuable thing you can send is a report of where it breaks on your real data.
Open an [issue](https://github.com/ArturRuppel/Iris/issues) to report a problem
or ask a usage question. [`CONTRIBUTING.md`](CONTRIBUTING.md) covers how to set
up a development environment and send a change, and carries a map of the repo
and the steps to build installers. For questions about the
statistics themselves, or about whether Iris suits your analysis, contact Artur
Ruppel at `artur@ruppel.pro`.

## Citing Iris

Iris has no DOI yet. Until it does, cite the libraries the analysis rested on
(see [Built on](#built-on)) and the methods in
[`docs/guide/reference/citations.md`](docs/guide/reference/citations.md). A DOI
and manuscript citation will come with the public release. For pre-publication
citation questions, contact Artur Ruppel at `artur@ruppel.pro`.

## License

AGPL-3.0. See [`LICENSE`](LICENSE).

## AI usage

Generative AI tools (Anthropic Claude) assisted with code drafting, refactoring,
tests, debugging, and documentation. The human author made the scientific,
architectural, and design decisions.

## Shared interface style

The interface vendors Harmonia's canonical stylesheet in `src/harmonia/`. Marine and teal identify controls; square panels and ink rules separate the workspace. Scientific palettes, data-type colours and workflow-node colours stay local. Harmonia's `sync.py` checks the copies on both workstations. Tablet headers wrap into two rows and touch controls retain 44 px targets.
