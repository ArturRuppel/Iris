# Browser runtime: Iris with nothing to install

**Purpose.** A colleague opens a link and uses Iris, with their data staying on
their own machine. The site is static, so there is no server to run or secure, and it
opens from a file share over `file://` as well as from any web host. Colleagues get
it through the static lab-book export.

**Evidence.** Before this design, the engine's test suite ran under Pyodide
314.0.7 at commit a98148d. Native passed 636 of 636. Pyodide passed 630, including
all 30 validation tests, with scipy 1.18.0 and numpy 2.4.6 in place of the pinned
1.16.3 and 2.2.6. The six failures do not apply to this runtime: five test static
file serving, and one starts real threads to provoke a race.

## Design

- **Engine.** `iris_engine/browser.py` calls the real FastAPI app through ASGI, so
  validation, status codes and error messages match the other deployments. Pyodide
  cannot start threads, so sync endpoints run inline and the coroutine is driven by
  hand.
- **Worker.** `src/engine.worker.ts` hosts Python in a Web Worker so that a long
  computation does not freeze the page. On `file://` Chromium blocks module scripts,
  `fetch`, file-backed workers and module workers from a blob. The app is therefore
  built as a classic script, and the worker is a classic worker created from memory.
  Pyodide refuses classic workers by testing `importScripts`, so the worker makes that
  call throw.
- **Routing.** `VITE_IRIS_RUNTIME=browser` sends every engine call in `types.ts` to
  the worker through `browserFetch`, which returns an ordinary `Response`.
- **Packages.** `tools/build-web.mjs` checks the SHA-256 of each exact wheel, then
  `tools/web-image.mjs` installs them into Pyodide running in Node, compiles every
  module (and the standard library) to bytecode with that same interpreter, strips
  what a running engine never reads (tests, type stubs, C sources, the `.py` of every
  module that has bytecode), and packs each package as one gzipped filesystem image
  (`src/fsImage.ts`). Images are cached beside the wheels. Each image and Pyodide's own
  files are written as base64 inside classic scripts, the one way a `file://` page in
  Chromium can read a neighbouring file. Nothing comes from a CDN at run time, so a
  build cannot change underneath a user. Hashes are checked at build time only.
- **Dependencies.** numpy, pandas, pyarrow (the `.iris` Parquet tables), scipy,
  statsmodels and patsy (the `rate` family's GLMs), matplotlib, pydantic and FastAPI,
  openpyxl (Excel import), and what Pyodide's lock file says they need. pingouin,
  seaborn, scikit-learn, xarray and their helpers were dropped in 2026-11: the tests
  call scipy.stats directly, and the beeswarm solver is vendored (`beeswarm.py`).
- **Boot.** The main thread sends the worker the manifest, then the files three at a
  time in manifest order: Pyodide first, then the packages, then the ones only the
  statistics need (scipy, statsmodels, patsy, openpyxl). The worker starts Python as
  soon as Pyodide's files are in and the rest is still arriving. Each image is
  decompressed off the thread (`DecompressionStream`, fflate where it is missing) and
  written into MEMFS in one pass without a copy. The shared libraries the engine's
  imports load, which the build records by importing the engine once, are loaded
  ahead of the import as soon as their package is in; emscripten rescans its whole
  global offset table after every library, so the worker answers that scan from a
  running list of unresolved entries. The engine is imported before the statistics'
  packages are written, those follow, and only then does a request run. After the
  first answer, queued behind it, the worker loads the statistics' libraries and
  imports scipy.stats and statsmodels.api, which the engine itself never imports at
  module load (the build asserts it).
- **Page.** The app renders at once; a card where the figure will appear shows the
  stage and a progress bar (reading and the worker's stages add up, so it stays
  monotonic while they overlap). Requests made meanwhile wait in the worker. The
  full-page screen is only for a boot that failed.
- **Autosave.** The existing slot lives on an IDBFS mount, which is a filesystem
  backed by browser storage, and is flushed after every autosave request. The final
  flush at page close may be lost because it cannot be awaited, so recovery can be
  one snapshot old.
- **Provenance.** The build stamps the commit, and `engine_snapshot` gains a
  `pyodide` entry, so a `.iris` file records that it was computed in a browser.
- **Gate.** `npm run test:pyodide` runs the engine suite under the same Pyodide, on
  the packages as the build shipped them (the images in `dist-web/`), so a file the
  image left out fails there. Its exclusions are listed in the script with reasons:
  the six tests named above, and the bridge's own native test, which needs a
  subprocess. `tools/boot-timing.mjs` times a cold boot stage by stage, then the first
  figure.

## Limits

The site is about 81 MB (about 60 MB over the wire). From disk on the development
laptop, in headless Chromium, the app shows at 0.3 s and the engine is ready at
about 5 s (it was about 26 s with wheels unpacked at boot). Every visit reads the
files and starts Python, and over a slow connection or share the read dominates.
Safari is untested; the boot uses only `DecompressionStream`, `Uint8Array.fromBase64`
where present, and dynamic `import()` of a blob, each with a plain fallback or
already required before.
WebAssembly memory is capped near 4 GB and computation is slower than native. Two
tabs share one autosave slot, as two clients of one server do today. Web fonts still
come from Google, which sends no user data but does make a third-party request.
