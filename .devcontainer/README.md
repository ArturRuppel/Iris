# Iris autonomous dev sandbox

A **rootless** Docker container where an AI agent (Claude Code) runs with
`--dangerously-skip-permissions` — full autonomy — while isolated from the rest
of the machine. It carries the full Iris toolchain (Node 20, Rust, Python +
the FastAPI engine) so the agent can build the frontend, run the engine and its
tests, and `cargo build` the Tauri shell. The **desktop GUI itself needs a real
display — run it on the host.**

## Isolation model

| Aspect      | Exposure                                                             |
|-------------|---------------------------------------------------------------------|
| Daemon      | **Rootless** — Docker runs as your user, not root. No root-equivalent `docker` group. |
| Filesystem  | **Only this project**, bind-mounted at `/workspace`. Nothing else.  |
| Network     | **Egress allowlist** — `--internal` net + filtering proxy; only allowlisted hosts reachable (see below). No credentials mounted, so no push/email regardless. |
| GPU         | None — Iris doesn't need it.                                         |
| Auth        | Interactive Claude login inside the container; nothing host-mounted.|
| State       | node_modules, cargo target, dep caches, and Claude auth live in named Docker volumes. |

Because the daemon is rootless, even a container breakout or a stray `-v /:/host`
mount only ever carries *your* privileges — it cannot read other users' files or
touch system files as root.

The container runs as **root internally**, which under rootless Docker maps to
your unprivileged host user. That is deliberate: it lets the container read/write
the bind-mounted `/workspace` and keeps files it creates owned by *you* on the
host (a non-root container user would map to an unwritable host subuid). It is
**not** host root.

### Why the named volumes

The host's `node_modules/` and `src-tauri/target/` are built for the host and are
git-ignored. To avoid the container clobbering them (and vice versa), the
container gets its **own** copies in named volumes, and Rust build output is
redirected off the bind mount via `CARGO_TARGET_DIR=/opt/iris-target`. Warm
npm/pip/cargo caches (also volumes) keep the per-run dependency install fast.

## Egress allowlist

The sandbox sits on an `--internal` Docker network with **no direct internet**.
Its only path out is `iris-proxy` (tinyproxy), which permits HTTPS `CONNECT`
only to hosts matching `proxy/allowlist`, and only on ports 443/563 (so SMTP is
refused). Everything else — arbitrary hosts, exfiltration targets, email — is
blocked, and there is no way to bypass the proxy (the network has no route).

Defaults allow Anthropic (Claude API + auth + server-side WebSearch), PyPI, the
npm registry, crates.io + rustup, Playwright browser downloads, and GitHub
(**read only** — no credentials are mounted, so the agent cannot push). To allow
another host:

```bash
echo '(^|\.)example\.com$' >> .devcontainer/proxy/allowlist
docker restart iris-proxy        # or just re-run run-sandbox.sh
```

Note: because filtering is by destination host, **direct client-side fetches to
non-listed hosts are blocked**. Claude's built-in WebSearch is server-side (via
`api.anthropic.com`), so search still works; fetching an arbitrary URL does not
unless you add its host.

## Headroom proxy (token compression)

The sandbox's Claude routes its Anthropic API traffic through **Headroom**
(token compression/caching) without anything being installed in the sandbox
image. `run-sandbox.sh` starts a separate `iris-headroom` container (built from
`headroom/Dockerfile`, which `pip install`s `headroom-ai`) on the internal
network and points the sandbox's `ANTHROPIC_BASE_URL` at it. Headroom forwards
upstream to `api.anthropic.com` through the **same** `iris-proxy` egress filter
(via `HTTPS_PROXY`), so the allowlist still governs all outbound traffic.

Unlike `headroom wrap claude` on the host, no `headroom_retrieve` **MCP** tool is
registered in the sandbox's Claude (that would mean installing headroom in the
sandbox). Instead the proxy uses Headroom's **CCR tool-injection**: it injects
`headroom_retrieve` into the request and resolves the tool-call server-side, so
compressed content stays re-expandable without a client-side MCP. (Do **not**
add `--no-ccr-inject-tool`/`--no-ccr-marker`: in headroom 0.26.0 that path
500s on an `UnboundLocalError`, which surfaces inside the sandbox as "API not
reachable".) `ENABLE_TOOL_SEARCH=true` is set so Claude
Code keeps on-demand tool loading active despite the custom base URL
(headroom issue #746). The container is recreated on every
launch; pin the version via `--build-arg HEADROOM_VERSION=…` in
`headroom/Dockerfile`.

## First-time setup (host)

Migrate to rootless Docker (installs `uidmap`/`slirp4netns`, sets up the rootless
daemon, disables the rootful daemon, and removes you from the `docker` group).
Run **without** sudo — it calls sudo only where needed:

```bash
bash .devcontainer/setup-rootless.sh
```

It verifies rootless works *before* tearing down the old setup. Afterwards, a
logout/login makes the group removal fully effective. For ad-hoc `docker` use in
your shell, add to `~/.bashrc`:

```bash
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
```

(`install-host-deps.sh` is the older rootful bootstrap, kept for reference.)

## Daily use

```bash
./.devcontainer/run-sandbox.sh            # build if needed, then launch Claude
./.devcontainer/run-sandbox.sh bash       # shell instead of Claude
./.devcontainer/run-sandbox.sh --rebuild  # rebuild the image
```

The launcher points at the rootless socket automatically. On startup the
container installs the engine's Python deps (from `engine/requirements.lock`)
and the frontend's `node_modules` — fast after the first run thanks to the warm
caches. Inside the container:

```bash
runtests                 # engine pytest + frontend typecheck/build (quick pair)
runtests engine -k scale # forward args to the engine pytest suite
runtests e2e             # boot engine+vite, run the Playwright smokes (heavier)
./dev.sh                 # engine (8765) + vite (5173) together, for poking around
cargo build --manifest-path src-tauri/Cargo.toml   # check the Rust shell builds
```

## Tests / GUI

`runtests` covers the CPU-only signal (engine pytest + frontend build), and
`runtests e2e` drives the real frontend with headless Playwright chromium. The
**Tauri desktop GUI** is not exercised in the container (no display): run it on
the host with `cargo tauri dev` / `npm run tauri dev`.

> **Note:** rootless Docker 29.5.x prints `WARNING: IPv4 forwarding is disabled.
> Networking will not work.` on container start. It is a **cosmetic** false
> alarm — the daemon checks `ip_forward` in the host netns instead of its own
> detached netns, where forwarding is enabled. Egress through the proxy works
> (e.g. `npm install` downloads fine). Fixed upstream in 29.6.0
> ([moby#52737](https://github.com/moby/moby/issues/52737)).

## Reset

```bash
docker rm -f iris-sandbox iris-proxy 2>/dev/null
docker volume rm iris-node-modules iris-cargo-target iris-cargo-registry \
                 iris-npm-cache iris-pip-cache iris-playwright iris-claude
docker network rm iris-internal iris-egress 2>/dev/null
docker image rm iris-sandbox iris-egress-proxy    # wipe images
```

## Notes

- VS Code users can "Reopen in Container" — `devcontainer.json` mirrors the
  toolchain and volumes (and runs against your rootless daemon once `DOCKER_HOST`
  is set). **Caveat:** VS Code does **not** wire up the egress-filtering proxy;
  that isolation only applies via `run-sandbox.sh`. Use the script for autonomous
  runs.
- The engine deps install from the committed `engine/requirements.lock`. The
  host runs Python 3.13; the container uses Ubuntu 24.04's Python 3.12, and the
  locked wheels (numpy/pandas/scipy/…) all ship 3.12 builds, so the install is
  reproducible. The PyInstaller *freeze* stays a host task (it must match the
  shipped interpreter).
