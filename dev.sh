#!/usr/bin/env bash
# One-command dev mode: starts the engine and the frontend together.
# Usage: ./dev.sh   — then open http://localhost:5173. Ctrl-C stops both.
#
# Robust against a stale engine from a previous run: a leftover process still
# holding ENGINE_PORT would keep serving OLD code — the freshly started engine
# fails to bind and exits, and the browser silently talks to the zombie (e.g. a
# 404 on a route that only exists in current source). So we free the port first,
# then verify the new engine actually answers before launching the frontend.
set -euo pipefail
cd "$(dirname "$0")"

ENGINE_PORT="${ENGINE_PORT:-8765}"
export ENGINE_PORT
# The browser client only reads VITE_-prefixed vars (types.ts: VITE_ENGINE_PORT),
# so mirror the port there or a non-default ENGINE_PORT splits the two halves.
export VITE_ENGINE_PORT="${ENGINE_PORT}"

# Stop any stale engine from a prior run before we start a new one. Primary
# method is by module name (`iris_engine.main` is unique to this app) — portable
# and not dependent on lsof/fuser/ss, which aren't always installed. As a
# best-effort supplement, also free ENGINE_PORT if some *other* process holds it.
#
# The `$` anchor below is load-bearing: it matches the bare dev invocation and
# NOT `iris_engine.main --serve`, which is the long-running tailnet service
# (iris.service on :8766 — see docs/serving.md). Without the anchor every
# ./dev.sh would kill the served app out from under the phone.
DEV_ENGINE_RE='iris_engine\.main$'

free_port() {
  if command -v pgrep >/dev/null 2>&1 && pgrep -f "${DEV_ENGINE_RE}" >/dev/null 2>&1; then
    echo "dev.sh: stopping stale engine(s) by name"
    pkill -f "${DEV_ENGINE_RE}" 2>/dev/null || true
    sleep 1
    pkill -9 -f "${DEV_ENGINE_RE}" 2>/dev/null || true
  fi
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti "tcp:${ENGINE_PORT}" -s tcp:LISTEN 2>/dev/null || true)
  elif command -v fuser >/dev/null 2>&1; then
    pids=$(fuser "${ENGINE_PORT}/tcp" 2>/dev/null || true)
  fi
  if [ -n "${pids}" ]; then
    echo "dev.sh: freeing port ${ENGINE_PORT} (PIDs: ${pids})"
    kill ${pids} 2>/dev/null || true
    sleep 1
    kill -9 ${pids} 2>/dev/null || true
  fi
}
free_port

# Start the engine and make sure both it and the frontend die on exit/Ctrl-C.
(cd engine && exec python -m iris_engine.main) &
ENGINE_PID=$!
trap 'kill "${ENGINE_PID}" 2>/dev/null || true' EXIT INT TERM

# Wait until the engine answers on /health. If it died (e.g. couldn't bind the
# port), fail loudly instead of letting the browser hit a stale/absent engine.
printf 'dev.sh: waiting for engine on :%s ' "${ENGINE_PORT}"
for i in $(seq 1 40); do
  if ! kill -0 "${ENGINE_PID}" 2>/dev/null; then
    echo
    echo "dev.sh: engine exited during startup — is port ${ENGINE_PORT} still in use?"
    exit 1
  fi
  if curl -sf "http://127.0.0.1:${ENGINE_PORT}/health" >/dev/null 2>&1; then
    echo "ok"
    break
  fi
  printf '.'
  sleep 0.5
  if [ "${i}" -eq 40 ]; then
    echo
    echo "dev.sh: engine did not become healthy in time"
    exit 1
  fi
done

npm run dev
