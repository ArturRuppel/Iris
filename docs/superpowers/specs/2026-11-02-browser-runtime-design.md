# Browser runtime: Iris with nothing to install

**Purpose.** A colleague opens a link and uses Iris, with their data staying on
their own machine. The site is static, so there is no server to run or secure, and it
opens from a file share over `file://` as well as from any web host. Colleagues get
it through the Pomice2 lab-book export.

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
  writes it and the Pyodide runtime as base64 inside classic scripts, the one way a
  `file://` page in Chromium can read a neighbouring file. The main thread loads them
  and passes the text to the worker, whose `fetch` override answers Pyodide from
  memory. Nothing comes from a CDN at run time, so a build cannot change underneath a
  user. Hashes are checked at build time only.
- **Autosave.** The existing slot lives on an IDBFS mount, which is a filesystem
  backed by browser storage, and is flushed after every autosave request. The final
  flush at page close may be lost because it cannot be awaited, so recovery can be
  one snapshot old.
- **Provenance.** The build stamps the commit, and `engine_snapshot` gains a
  `pyodide` entry, so a `.iris` file records that it was computed in a browser.
- **Gate.** `npm run test:pyodide` runs the engine suite under the same Pyodide. Its
  exclusions are listed in the script with reasons: the six tests named above, and
  the bridge's own native test, which needs a subprocess.

## Limits

The site is about 96 MB and boots in about 13 s in Chromium and about 50 s in Firefox
on the development laptop. Every visit reads the files and starts Python, and over a slow share the read will
dominate. Safari is untested.
WebAssembly memory is capped near 4 GB and computation is slower than native. Two
tabs share one autosave slot, as two clients of one server do today. Web fonts still
come from Google, which sends no user data but does make a third-party request.
