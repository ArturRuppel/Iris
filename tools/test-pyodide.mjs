#!/usr/bin/env node
/* Run the engine and validation suites under the same Pyodide the web build ships.
   Run this after any change to the engine or to the versions in build-web.mjs,
   because the web build's scipy and numpy differ from requirements.lock and the
   validation corpus is what stands behind its numbers. */
import { mkdtempSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Each exclusion needs a reason that holds for the browser runtime. */
const DESELECT = [
  "tests/test_served_mode.py",                 // static file serving, which the static site does not use
  "tests/test_browser_dispatch.py",            // spawns a subprocess; test-pyodide itself covers this path
  "tests/test_stats_cache.py::test_caches_survive_concurrent_hammering", // starts real threads
];

/* A copy, because the suite writes artifacts and the mount is read-write. */
const work = mkdtempSync(join(tmpdir(), "iris-pyodide-"));
cpSync(join(ROOT, "engine"), join(work, "engine"), {
  recursive: true, filter: (p) => !/__pycache__|\/build$|\/dist$|\.pytest_cache|\.ruff_cache/.test(p),
});
mkdirSync(join(work, "src"));
cpSync(join(ROOT, "src", "examples"), join(work, "src", "examples"), { recursive: true });

const py = await loadPyodide({ packageCacheDir: join(ROOT, "node_modules", ".cache", "iris-web") });
const quiet = { messageCallback: () => {} };
await py.loadPackage(["micropip", "numpy", "pandas", "scipy", "matplotlib", "statsmodels",
  "pyarrow", "patsy", "pydantic", "fastapi", "pytest"], quiet);
await py.pyimport("micropip").install(["openpyxl==3.1.5", "et-xmlfile==2.0.0", "httpx"]);

py.FS.mkdirTree("/w");
py.FS.mount(py.FS.filesystems.NODEFS, { root: work }, "/w");
py.globals.set("deselect", py.toPy(DESELECT));
const rc = py.runPython(`
import contextlib, os, sys
os.chdir("/w/engine"); sys.path.insert(0, "/w/engine")
from iris_engine import browser
browser.install()

# The tests use Starlette's TestClient, which runs the app through a thread portal.
# Replacing the portal with the browser bridge's driver means every endpoint test
# exercises the code path the web build uses.
class Portal:
    def call(self, fn, *a, **k):
        r = fn(*a, **k)
        return browser.drive(r) if hasattr(r, "send") else r
from starlette.testclient import TestClient
@contextlib.contextmanager
def _portal(self): yield Portal()
TestClient._portal_factory = _portal

# The bridge itself, as the worker calls it, and the provenance it must report.
import json
status, _, body = browser.dispatch("GET", "/health")
assert status == 200, status
assert json.loads(body)["engine_snapshot"]["pyodide"], "results must record the browser runtime"

import pytest
args = ["tests", "validation", "-q", "-p", "no:cacheprovider", "--tb=short"]
for d in deselect:
    args += ["--ignore=" + d] if d.endswith(".py") else ["--deselect=" + d]
int(pytest.main(args))
`);
rmSync(work, { recursive: true, force: true });
console.log(rc === 0 ? "Pyodide suite passed" : `Pyodide suite FAILED (pytest exit ${rc})`);
process.exit(rc);
