# Triad — tier 1 walking skeleton

The reactive triad (table ↔ figure ↔ statistics) with a **real** engine:
every number comes from scipy/pingouin, every figure from matplotlib, and one
declarative analysis spec (v1.0, frozen) drives both.

```
┌─────────────┐   HTTP (localhost:8765)   ┌──────────────────────────┐
│  React/TS    │ ───────────────────────► │  Python engine (sidecar)  │
│  Jotai state │  /analyze /export /save  │  pandas · scipy · pingouin│
│  SVG inject  │ ◄─────────────────────── │  matplotlib (gid-tagged)  │
└─────────────┘    SVG + stats + spec     └──────────────────────────┘
        ▲ both hosted by the Tauri shell (spawns/kills the sidecar) ▲
```

## Quickstart (dev mode, no Tauri needed)

Terminal 1 — engine:
```bash
cd engine
pip install -r requirements.txt
python -m triad_engine.main          # serves on 127.0.0.1:8765
```

Terminal 2 — frontend:
```bash
npm install
npm run dev                          # http://localhost:5173
```

The app loads a sample dataset. Edit cells, click points to exclude them,
override the recommended test, switch to a journal size preset, export
SVG/PDF/PNG, save a `.viz` document.

## Desktop shell (Tauri)

Requires the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)
(Rust, plus webkit2gtk on Linux). Then:

```bash
npm install
cargo install tauri-cli --version "^2"
cargo tauri dev        # spawns engine via system python3; set TRIAD_PYTHON to override
```

## Packaging (tier 1 exit)

The engine freezes to a single sidecar binary which the shell bundles via
`bundle.externalBin` and spawns instead of system Python (`spawn_engine()`
falls back to system Python when no bundled binary sits next to the shell
executable, so dev mode is unchanged).

```bash
cd engine
pip install -r requirements-dev.txt
pyinstaller triad-engine.spec          # → dist/triad-engine (~210 MB)
python tests/smoke_frozen.py           # protocol + lifecycle against the binary

# Tauri expects the sidecar named with the host target triple:
triple=$(rustc -vV | sed -n 's/host: //p')
mkdir -p ../src-tauri/binaries
cp dist/triad-engine "../src-tauri/binaries/triad-engine-$triple"

cd .. && npx tauri build               # installers in src-tauri/target/release/bundle/
```

Packaging notes, learned the hard way:
- `triad_engine/main.py` uses relative imports, so the spec freezes
  `freeze_entry.py`, not `main.py` directly.
- `freeze_runtime_hook.py` pins `MPLCONFIGDIR` to a per-user cache dir.
  Without it, matplotlib's font cache can land somewhere non-persistent and
  the first launch's full font scan (minutes on a font-heavy machine)
  repeats every launch. First launch per machine still pays it once; the
  frontend shows "Starting engine…" and polls health rather than timing out.
- The shell picks a free port at runtime (8765 first) and the frontend asks
  for it via the `engine_port` Tauri command; dev mode keeps plain 8765.
- Code signing/notarization is deferred to tier 3 (installers are unsigned).

## What is validated vs. scaffolded

Validated end-to-end in CI-like conditions (see `engine/tests/`, 8 tests):
- Welch t / Mann–Whitney / Shapiro–Wilk / Hedges' g match scipy ground truth
- SVG contains one `<use>` per data row inside gid-tagged groups
  (the contract the frontend's click-to-exclude relies on)
- Exclusions propagate into n, summaries, and the generated methods text
- PDF export MediaBox measures exactly 89 × 70 mm for `nature_single_column`
- `.viz` document save/load roundtrip
- Frontend compiles under strict TypeScript and builds with Vite

Scaffolded, needs a real machine: Tauri shell compile, sidecar lifecycle
under the shell, installers, signing.

## Tier 1 exit criterion

A stranger double-clicks an installer, imports a CSV, makes a figure, exports
a PDF that opens in Illustrator with correct fonts (fonttype 42) and
dimensions. The engine and frontend halves of that path are done; the
packaging half is the remaining work.

## Repo map

```
engine/triad_engine/   stats.py (pingouin orchestration + recommendation)
                       compiler.py (spec → matplotlib, gid tagging, mm presets)
                       document.py (.viz ZIP format + sample data)
                       main.py (FastAPI protocol surface)
engine/tests/          validation suite (pytest)
src/                   React frontend: state.ts (Jotai atoms, derived spec),
                       types.ts (schema v1.0 types + protocol client),
                       components/ (DataTable, FigurePane, StatsPanel)
src-tauri/             desktop shell scaffold
```

Tier 2 starts from here: more plot/test families ride on the same spec; the
table swaps to Glide/AG Grid; the import wizard fronts `pandas.read_csv`.
