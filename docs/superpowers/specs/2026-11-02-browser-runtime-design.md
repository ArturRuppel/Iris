# Browser runtime: Iris with nothing to install

**Purpose.** A colleague opens a link and uses Iris, with their data staying on
their own machine. The site is static, so there is no server to run or secure.

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
  computation does not freeze the page.
- **Routing.** `VITE_IRIS_RUNTIME=browser` sends every engine call in `types.ts` to
  the worker through `browserFetch`, which returns an ordinary `Response`.
- **Packages.** `tools/build-web.mjs` copies the Pyodide runtime and exact wheels
  into the site after checking each one's SHA-256. Nothing is fetched from a CDN at
  run time, so a deployed version cannot change underneath a user.
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

The site is about 72 MB and boots in about 13 s in Chromium and about 50 s in Firefox
on the development laptop. A return visit skips the download, but not the Python
start-up, so it takes about as long on a fast connection. Safari is untested.
WebAssembly memory is capped near 4 GB and computation is slower than native. Two
tabs share one autosave slot, as two clients of one server do today. Web fonts still
come from Google, which sends no user data but does make a third-party request.
