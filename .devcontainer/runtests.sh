#!/usr/bin/env bash
# Run Iris's CPU-only checks headlessly inside the sandbox.
#
# Three suites, each runnable on its own or all together (the default):
#
#   engine    pytest over engine/tests — the FastAPI analysis engine. Pure
#             CPU/headless; the fast, default-on signal.
#   front     `npm run build` — tsc typecheck + vite production build of the
#             React frontend. Catches type and bundle errors.
#   e2e       Playwright smokes in e2e/*.mjs. These drive the REAL app, so the
#             helper boots the engine (port 8765) and the vite dev server (5173),
#             installs headless chromium on first run, then runs each .mjs under
#             xvfb. Heavier and flakier than the other two; opt-in.
#
# Usage:
#   runtests                 # engine + front (the quick, reliable pair)
#   runtests engine          # just the engine pytest suite
#   runtests engine -k scale # forward extra args to pytest
#   runtests front           # just the frontend typecheck/build
#   runtests e2e             # boot servers + run the Playwright smokes
#   runtests all             # engine + front + e2e
#
# The actual Tauri desktop GUI is not exercised here (no display); run it on the
# host. `cargo build` works in the sandbox if you want to check the Rust shell.
set -euo pipefail

cd /workspace

run_engine() { echo ">>> [engine] pytest"; ( cd engine && exec pytest "$@" ); }
run_front()  { echo ">>> [front] npm run build"; npm run build; }

run_e2e() {
    echo ">>> [e2e] installing headless chromium (cached after first run)..."
    npx --yes playwright install chromium

    echo ">>> [e2e] starting engine (8765) + vite (5173)..."
    ( cd engine && python -m iris_engine.main ) & local engine_pid=$!
    npm run dev >/dev/null 2>&1 & local vite_pid=$!
    trap 'kill "$engine_pid" "$vite_pid" 2>/dev/null || true' EXIT

    # Wait for the vite dev server to answer before driving the browser.
    for _ in $(seq 1 60); do
        if curl -fsS http://localhost:5173 >/dev/null 2>&1; then break; fi
        sleep 1
    done

    local rc=0
    for t in e2e/*.mjs; do
        echo ">>> [e2e] $t"
        xvfb-run -a node "$t" || rc=1
    done
    return "$rc"
}

target="${1:-default}"
case "$target" in
    engine) shift; run_engine "$@" ;;
    front)  shift; run_front ;;
    e2e)    shift; run_e2e ;;
    all)    shift; run_engine && run_front && run_e2e ;;
    default) run_engine && run_front ;;
    *)      # No recognised target → treat all args as pytest args (common case).
            run_engine "$@" ;;
esac
