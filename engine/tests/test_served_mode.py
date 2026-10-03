"""Served mode: the engine also hands out the built frontend.

The desktop app never exercises this — Tauri serves its own bundle and Vite
serves dev — so these are the only tests standing between a frontend change and
a broken tailnet deployment (see docs/serving.md).

The two things that actually go wrong: the catch-all mount swallowing an API
route, and the manifest going out with the wrong content type (which Safari
ignores silently, giving you a bookmark instead of an installed app).
"""
import importlib
import mimetypes

import pytest
from fastapi.testclient import TestClient

from iris_engine import main as main_mod


@pytest.fixture()
def served(tmp_path, monkeypatch):
    """A fresh app module with IRIS_DIST pointing at a stand-in bundle."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Iris</title>")
    (dist / "assets" / "index-abc123.js").write_text("export default 1;\n")
    (dist / "manifest.webmanifest").write_text('{"name": "Iris"}')
    (dist / "apple-touch-icon.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (dist / "sw.js").write_text("self.addEventListener('fetch', () => {});\n")

    monkeypatch.setenv("IRIS_DIST", str(dist))
    mod = importlib.reload(main_mod)
    try:
        yield mod
    finally:
        monkeypatch.delenv("IRIS_DIST", raising=False)
        importlib.reload(main_mod)   # leave the shared module as we found it


def test_mounts_only_when_a_build_exists(tmp_path, monkeypatch):
    monkeypatch.setenv("IRIS_DIST", str(tmp_path / "nothing-here"))
    mod = importlib.reload(main_mod)
    try:
        # Dev and Tauri both land here, and neither may grow a static mount.
        assert mod.SERVING_FRONTEND is False
        assert TestClient(mod.app).get("/").status_code == 404
    finally:
        monkeypatch.delenv("IRIS_DIST", raising=False)
        importlib.reload(main_mod)


def test_serves_the_bundle(served):
    c = TestClient(served.app)
    assert served.SERVING_FRONTEND is True

    r = c.get("/")
    assert r.status_code == 200
    assert "<title>Iris</title>" in r.text
    assert c.get("/assets/index-abc123.js").status_code == 200


def test_api_routes_win_over_the_catch_all_mount(served):
    """The mount is registered at "/" and last; Starlette matches in order, so
    every API route above it must still be reachable. Get this wrong and the
    phone gets index.html back from /analyze."""
    c = TestClient(served.app)

    assert c.get("/health").json()["status"] == "ok"
    assert c.get("/sample").status_code == 200
    # A real API route reached with a bad session id: 409 is the engine
    # answering. 200-with-HTML would mean the mount ate it.
    assert c.post("/table/nope/rows", json={}).status_code == 409


def test_manifest_content_type(served):
    """Safari silently ignores a manifest served as octet-stream. main.py
    registers the type at import so this cannot depend on /etc/mime.types."""
    assert mimetypes.guess_type("m.webmanifest")[0] == "application/manifest+json"
    r = TestClient(served.app).get("/manifest.webmanifest")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/manifest+json")


def test_apple_touch_icon_at_the_document_root(served):
    """iOS asks for this path whatever the markup says, and a 404 is one of the
    ways you end up with a screenshot of the page for a home-screen icon."""
    for path in ("/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"):
        r = TestClient(served.app).get(path)
        assert r.status_code == 200, path
        assert r.headers["content-type"] == "image/png"


def test_the_shell_and_its_worker_are_never_heuristically_cached(served):
    """public/sw.js is server-first, which only means "the build on disk" if
    the browser never answers the page or the worker from its HTTP cache. The
    hashed bundle is left cacheable: a new build has new names."""
    c = TestClient(served.app)
    for path in ("/", "/index.html", "/sw.js"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert r.headers.get("cache-control") == "no-cache", path
    assert "cache-control" not in c.get("/assets/index-abc123.js").headers
    # and the engine's own answers are not touched
    assert "cache-control" not in c.get("/health").headers
