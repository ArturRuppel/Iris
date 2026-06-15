#!/usr/bin/env bash
# One-command dev mode: starts the engine and the frontend together.
# Usage: ./dev.sh   — then open http://localhost:5173. Ctrl-C stops both.
cd "$(dirname "$0")"
(cd engine && exec python -m iris_engine.main) &
ENGINE_PID=$!
trap 'kill $ENGINE_PID 2>/dev/null' EXIT
npm run dev
