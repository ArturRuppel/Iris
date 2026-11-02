"""The browser bridge must behave like the HTTP server it replaces.

`install()` patches the thread pool for the whole process, so these run in a
subprocess and leave the rest of the suite on the ordinary code path. Under real
Pyodide, `npm run test:pyodide` sends the whole endpoint suite through the same
driver.
"""
import subprocess
import sys
import textwrap
from pathlib import Path

SCRIPT = textwrap.dedent("""
    import json, threading
    from iris_engine import browser, main
    browser.install()
    # armed after the imports: the trap covers request handling, and matplotlib's
    # font-cache timer on a fresh HOME is not part of that
    def no_threads(self): raise RuntimeError("can't start new thread")
    threading.Thread.start = no_threads

    status, headers, body = browser.dispatch("GET", "/health")
    assert status == 200, status
    assert "application/json" in json.loads(headers)["content-type"]
    assert "scipy" in json.loads(body)["engine_snapshot"]

    # a request that fails validation gets FastAPI's own 422
    status, _, body = browser.dispatch(
        "POST", "/table/create", '{"Content-Type": "application/json"}', b'{"table": 3}')
    assert status == 422, status
    assert json.loads(body)["detail"]

    # an HTTPException keeps its status, and the body reaches the endpoint
    status, _, _ = browser.dispatch(
        "POST", "/table/nope/rows", '{"Content-Type": "application/json"}',
        b'{"start": 0, "end": 1}')
    assert status in (404, 409), status

    status, _, _ = browser.dispatch("GET", "/no/such/route")
    assert status == 404, status

    # an async route with a sync helper, posted the way the autosave flush posts
    status, _, body = browser.dispatch("POST", "/autosave/clear", "{}", b"{}")
    assert status == 200, status
    print("ok")
""")


def test_dispatch_runs_the_real_app_without_threads(tmp_path):
    proc = subprocess.run(
        [sys.executable, "-c", SCRIPT], capture_output=True, text=True,
        cwd=Path(__file__).resolve().parents[1],
        # no built frontend, as in the browser: a checkout's dist/ would mount
        # static file serving, which the web build does not contain
        env={"IRIS_AUTOSAVE_DIR": str(tmp_path), "IRIS_DIST": str(tmp_path / "none"),
             "PATH": "/usr/bin:/bin",
             "HOME": str(tmp_path)})
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout.strip().endswith("ok")
