"""Host / Origin guard (main.py `_origin_guard`): a page on another site, or one
that DNS-rebinds its own name to loopback, must not drive the engine — in
particular the text/plain autosave POST, which needs no CORS preflight."""
import json

import pytest
from fastapi.testclient import TestClient

from iris_engine import autosave, main
from iris_engine.main import app

client = TestClient(app)

SCHEMA = {"schema_version": "1.0",
          "columns": [{"name": "g", "type": "categorical", "label": "G",
                       "levels": ["a", "b"]},
                      {"name": "y", "type": "numeric", "label": "Y"}]}
ROWS = [{"id": "1", "g": "a", "y": 1.0}, {"id": "2", "g": "b", "y": 2.0}]
SPEC = {"spec_version": "2.1", "id": "pt_1", "title": "A", "table_id": "t1"}
FOREIGN = "https://evil.example"


def _snapshot(title="A"):
    return json.dumps({
        "tables": [{"name": "t1", "table": {"schema": SCHEMA, "rows": ROWS},
                    "hierarchy": {"spine": [], "fn": {}}}],
        "analyses": [{**SPEC, "title": title}],
        "provenance": {}, "data_fingerprint": "fp1"})


def _post_snapshot(title="A", **headers):
    return client.post("/autosave/snapshot", content=_snapshot(title),
                       headers={"Content-Type": "text/plain", **headers})


@pytest.fixture()
def slot(monkeypatch, tmp_path):
    monkeypatch.setenv("IRIS_AUTOSAVE_DIR", str(tmp_path))
    assert _post_snapshot("original").status_code == 200
    return tmp_path


def _title(slot):
    return autosave.load_snapshot(slot)["analyses"][0]["title"]


# ---- Host ----

@pytest.mark.parametrize("host", ["evil.example", "evil.example:8766",
                                  "127.0.0.1.evil.example"])
def test_foreign_host_is_400(host):
    r = client.get("/autosave/status", headers={"Host": host})
    assert r.status_code == 400


@pytest.mark.parametrize("host", ["127.0.0.1:8766", "localhost", "[::1]:8766",
                                  "LOCALHOST:1"])
def test_loopback_hosts_pass(host):
    assert client.get("/health", headers={"Host": host}).status_code == 200


def test_configured_host_passes(monkeypatch):
    monkeypatch.setenv("IRIS_ALLOWED_HOSTS", "testserver, figures.example:443")
    assert client.get("/health", headers={"Host": "figures.example"}).status_code == 200


def test_served_names_from_tailscale_pass(monkeypatch):
    # --serve admits this machine's tailnet name, looked up from the CLI
    monkeypatch.setattr(main, "_tailnet_names", lambda: {"box.tailnet.example"})
    monkeypatch.setitem(main._served_lookup, "enabled", True)
    monkeypatch.setitem(main._served_lookup, "at", 0.0)
    monkeypatch.setattr(main, "_served_names", set())
    r = client.get("/health", headers={"Host": "box.tailnet.example:8766"})
    assert r.status_code == 200
    assert client.get("/health", headers={"Host": "evil.example"}).status_code == 400


# ---- Origin on writes ----

def test_foreign_origin_text_plain_snapshot_is_403_and_slot_unchanged(slot):
    r = _post_snapshot("overwritten", Origin=FOREIGN)
    assert r.status_code == 403
    assert _title(slot) == "original"


def test_cross_site_fetch_metadata_without_origin_is_403(slot):
    r = _post_snapshot("overwritten", **{"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403
    assert _title(slot) == "original"


def test_foreign_origin_clear_is_403(slot):
    r = client.post("/autosave/clear", headers={"Origin": FOREIGN})
    assert r.status_code == 403
    assert autosave.status(slot)["exists"] is True


def test_null_origin_is_403(slot):
    assert client.post("/autosave/clear", headers={"Origin": "null"}).status_code == 403


def test_same_origin_write_passes(slot):
    # the served page: Origin names the Host it came in on (https through
    # Tailscale Serve, while the engine itself speaks http)
    r = _post_snapshot("same", Origin="https://testserver",
                       **{"Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200 and _title(slot) == "same"
    r = client.post("/autosave/clear",
                    headers={"Host": "127.0.0.1:8766", "Origin": "http://127.0.0.1:8766"})
    assert r.status_code == 200


def test_same_host_other_port_is_foreign(slot):
    r = client.post("/autosave/clear", headers={"Host": "127.0.0.1:8766",
                                                "Origin": "http://127.0.0.1:9999"})
    assert r.status_code == 403


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173",
                                    "tauri://localhost", "http://tauri.localhost"])
def test_allowed_cross_origin_write_passes(slot, origin):
    r = _post_snapshot("dev", Origin=origin, **{"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 200 and _title(slot) == "dev"


def test_configured_origin_passes(slot, monkeypatch):
    monkeypatch.setenv("IRIS_ALLOWED_ORIGINS", "https://figures.example")
    assert _post_snapshot("cfg", Origin="https://figures.example").status_code == 200


def test_no_origin_write_passes(slot):
    # curl, agents and tests on loopback send neither Origin nor Sec-Fetch-Site
    assert _post_snapshot("curl").status_code == 200 and _title(slot) == "curl"
    assert client.post("/autosave/clear").status_code == 200
    assert autosave.status(slot)["exists"] is False


def test_foreign_origin_get_is_served_without_cors_header(slot):
    r = client.get("/autosave/status", headers={"Origin": FOREIGN})
    assert r.status_code == 200
    assert "access-control-allow-origin" not in r.headers


def test_allowed_origin_get_gets_cors_header(slot):
    r = client.get("/autosave/status", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_foreign_preflight_gets_no_allow_header():
    r = client.options("/autosave/snapshot", headers={
        "Origin": FOREIGN, "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in r.headers
