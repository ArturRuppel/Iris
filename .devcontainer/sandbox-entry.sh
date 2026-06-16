#!/usr/bin/env bash
# Entry point for the Iris sandbox container.
#
#  1. Install the engine's Python deps into /opt/iris-venv from the committed
#     lock (engine/requirements.lock + requirements-dev.txt). The venv lives off
#     the bind mount and is recreated/refreshed per run; a warm pip cache (named
#     volume) makes an already-satisfied install near-instant.
#  2. Install the frontend's node_modules. node_modules is a named volume (not
#     the host's, which is built for the host), so `npm install` populates it on
#     first run and is a fast no-op afterwards thanks to the npm cache volume.
#  3. Hand off to whatever command was passed; with no args, launch Claude Code
#     in fully-autonomous mode.
#
# This is a development sandbox: build the frontend, run the engine + its tests,
# and `cargo build` the Tauri shell here. The actual desktop GUI needs a real
# display — run it on the host.
set -euo pipefail

echo ">>> [sandbox] pip install engine deps (fast after first run via pip cache)..."
pip install -r engine/requirements.lock -r engine/requirements-dev.txt

echo ">>> [sandbox] npm install (fast after first run via npm cache + node_modules volume)..."
npm install --no-audit --no-fund

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

echo ">>> [sandbox] Launching Claude Code (--dangerously-skip-permissions)."
echo ">>> [sandbox] First run will prompt you to authenticate."
exec claude --dangerously-skip-permissions
