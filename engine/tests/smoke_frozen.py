"""Smoke test for the FROZEN sidecar binary (dist/iris-engine).

Not collected by pytest (no test_ prefix) because it needs the PyInstaller
build to exist. Run after every freeze:

    cd engine && pyinstaller iris-engine.spec && python tests/smoke_frozen.py

Validates the packaging contract the in-process suite cannot: the binary
boots, serves the full protocol, honors ENGINE_PORT, refuses a taken port,
and dies cleanly on SIGTERM.
"""
import base64
import json
import re
import signal
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.test_engine import make_spec, make_table  # noqa: E402

BINARY = Path(__file__).resolve().parents[1] / "dist" / "iris-engine"
PORT = 8901  # away from dev's 8765


def req(path: str, body: dict | None = None) -> dict:
    url = f"http://127.0.0.1:{PORT}{path}"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=30) as resp:
        return json.loads(resp.read())


def wait_for_health(timeout_s: float = 600) -> dict:
    # first boot on a machine builds matplotlib's font cache (minutes);
    # the runtime hook makes that once-per-user, not once-per-launch
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            return req("/health")
        except OSError:
            time.sleep(0.5)
    raise TimeoutError(f"engine not healthy within {timeout_s}s")


def main() -> None:
    assert BINARY.is_file(), f"frozen binary missing: {BINARY} — build it first"
    checks = 0

    def ok(label: str) -> None:
        nonlocal checks
        checks += 1
        print(f"  ok {checks}: {label}")

    import os
    env = {**os.environ, "ENGINE_PORT": str(PORT)}
    proc = subprocess.Popen([str(BINARY)], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        t0 = time.monotonic()
        health = wait_for_health()
        boot = time.monotonic() - t0
        snap = health["engine_snapshot"]
        assert all(k in snap for k in ("scipy", "pingouin", "matplotlib"))
        ok(f"boots and reports versions (cold start {boot:.1f}s)")

        sample = req("/sample")
        assert len(sample["rows"]) > 0
        ok("serves sample dataset")

        body = req("/analyze", {"table": make_table(), "spec": make_spec()})
        svg = body["figure"]["svg"]
        for g in body["figure"]["point_groups"]:
            m = re.search(rf'<g id="{g["gid"]}"(.*?)</g>', svg, re.S)
            assert m and len(re.findall(r"<use\b", m.group(1))) == len(g["row_ids"])
        assert body["stats"]["result"]["test"] == "welch_t"
        ok("analyze: stats + gid-tagged SVG contract")

        spec = make_spec()
        spec["style"]["overrides"] = {"width_mm": 89, "height_mm": 70}
        exp = req("/export", {"table": make_table(), "spec": spec,
                              "format": "pdf", "dpi": 300})
        pdf = base64.b64decode(exp["data_base64"])
        m = re.search(rb"/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", pdf)
        assert m, "no MediaBox"
        w_mm = float(m.group(1)) * 25.4 / 72
        h_mm = float(m.group(2)) * 25.4 / 72
        assert abs(w_mm - 89) < 0.5 and abs(h_mm - 70) < 0.5, (w_mm, h_mm)
        ok(f"PDF export measures {w_mm:.1f} x {h_mm:.1f} mm")

        saved = req("/document/save", {"table": make_table(),
                                       "analyses": [make_spec()],
                                       "provenance": {"exclusions": []}})
        loaded = req("/document/load", {"data_base64": saved["data_base64"]})
        assert len(loaded["rows"]) == 40
        ok(".iris save/load roundtrip")

        # port collision: a second instance on the same port must exit nonzero
        clash = subprocess.run([str(BINARY)], env=env,
                               capture_output=True, timeout=120)
        assert clash.returncode != 0, "second instance on a taken port must fail"
        ok("refuses an already-taken port")

        # parent-death watchdog: with IRIS_WATCH_STDIN=1 (how the shell
        # spawns us), closing the stdin pipe must end the process
        watched = subprocess.Popen(
            [str(BINARY)], env={**env, "ENGINE_PORT": str(PORT + 1),
                                "IRIS_WATCH_STDIN": "1"},
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(3)  # let it boot far enough to have started the watcher
        assert watched.poll() is None, "engine died before stdin closed"
        watched.stdin.close()
        assert watched.wait(timeout=15) == 0
        ok("exits when the shell's stdin pipe closes (orphan prevention)")
    finally:
        proc.send_signal(signal.SIGTERM)
        rc = proc.wait(timeout=10)
        print(f"  ok: SIGTERM honored (exit {rc})")

    time.sleep(0.5)
    with socket.socket() as s:  # port actually released (REUSEADDR skips
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # TIME_WAIT,
        s.bind(("127.0.0.1", PORT))  # matching how uvicorn itself rebinds)
    print(f"PASS — frozen sidecar smoke test, {checks + 1} checks")


if __name__ == "__main__":
    main()
