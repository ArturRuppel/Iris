"""Run the engine's real FastAPI app inside Pyodide, in a browser Web Worker.

The browser has no sockets for uvicorn to listen on, so each request calls the
app directly over ASGI. Going through the app rather than around it keeps request
validation, status codes and error messages identical to the other deployments.

Pyodide cannot start threads, and FastAPI runs sync endpoints in a thread pool.
`install()` runs them inline instead. Nothing then suspends for real, so `drive`
can advance the ASGI coroutine by hand without an event loop.
"""
from __future__ import annotations

import json
from urllib.parse import urlsplit

_MAX_STEPS = 100_000


async def _run_inline(func, *args, **kwargs):
    return func(*args, **kwargs)


def install() -> None:
    """Replace the thread pool with inline calls. Process-wide, so only the browser
    runtime and its tests call it."""
    import fastapi.concurrency
    import fastapi.dependencies.utils
    import fastapi.routing
    import starlette.concurrency
    import starlette.routing
    for module in (starlette.concurrency, starlette.routing, fastapi.routing,
                   fastapi.concurrency, fastapi.dependencies.utils):
        if hasattr(module, "run_in_threadpool"):
            module.run_in_threadpool = _run_inline


def drive(coro):
    """Run a coroutine that never waits on anything external to completion."""
    try:
        for _ in range(_MAX_STEPS):
            coro.send(None)
    except StopIteration as stop:
        return stop.value
    coro.close()
    raise RuntimeError("ASGI app suspended on something that will never complete")


def dispatch(method: str, url: str, headers_json: str = "{}", body: bytes = b""):
    """One HTTP request through the app, as `(status, headers_json, body_bytes)`."""
    from .main import app

    parts = urlsplit(url)
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": method.upper(), "scheme": "http", "root_path": "",
        "path": parts.path, "raw_path": parts.path.encode(),
        "query_string": parts.query.encode(),
        "headers": [(k.lower().encode("latin-1"), str(v).encode("latin-1"))
                    for k, v in json.loads(headers_json).items()],
        "client": ("browser", 0), "server": ("browser", 80),
    }
    pending = [{"type": "http.request", "body": bytes(body), "more_body": False}]
    status, headers, chunks = None, [], []

    async def receive():
        return pending.pop() if pending else {"type": "http.disconnect"}

    async def send(message):
        nonlocal status, headers
        if message["type"] == "http.response.start":
            status = message["status"]
            headers = message.get("headers", [])
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))

    try:
        drive(app(scope, receive, send))
    except Exception:
        # ServerErrorMiddleware sends its 500 and then re-raises for the server to
        # log. Print the traceback for the console, and only re-raise when no
        # response went out at all.
        import traceback
        traceback.print_exc()
        if status is None:
            raise
    return status, json.dumps({k.decode("latin-1"): v.decode("latin-1")
                               for k, v in headers}), b"".join(chunks)
