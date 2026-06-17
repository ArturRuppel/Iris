#!/usr/bin/env bash
# Launch the Iris autonomous sandbox.
#
#   ./.devcontainer/run-sandbox.sh            # build (if needed) + start Claude
#   ./.devcontainer/run-sandbox.sh bash       # drop into a shell instead
#   ./.devcontainer/run-sandbox.sh --rebuild  # force a fresh image build
#
# Isolation guarantees:
#   * Runs against ROOTLESS Docker (daemon = your user, not root), so a container
#     breakout or stray bind-mount only ever has your privileges, never root's.
#   * Only this project directory is mounted (at /workspace). Nothing else on
#     the host filesystem is visible to the container.
#   * EGRESS ALLOWLIST: the sandbox sits on an --internal docker network with no
#     direct internet. Its only way out is a filtering proxy (iris-proxy) that
#     permits HTTPS only to hosts in .devcontainer/proxy/allowlist. No
#     credentials are mounted, so it cannot push/email regardless.
#   * No GPU — this sandbox is for development; run the desktop GUI on the host.
#   * node_modules / cargo target / dep caches / Claude auth live in named
#     volumes, so the host's host-built artifacts and home dir are never touched.
#     `docker volume rm` resets them.
#
# First-time host setup: bash .devcontainer/setup-rootless.sh
set -euo pipefail

# Talk to the rootless daemon's per-user socket (unless the caller overrode it).
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DOCKER_HOST="${DOCKER_HOST:-unix://${XDG_RUNTIME_DIR}/docker.sock}"

if ! docker info >/dev/null 2>&1; then
    echo "!! Can't reach the rootless Docker daemon at ${DOCKER_HOST}."
    echo "   Run the one-time setup first:  bash .devcontainer/setup-rootless.sh"
    echo "   Or check:  systemctl --user status docker.service"
    exit 1
fi

IMAGE="iris-sandbox"
PROXY_IMAGE="iris-egress-proxy"
PROXY_NAME="iris-proxy"
HEADROOM_IMAGE="iris-headroom-proxy"
HEADROOM_NAME="iris-headroom"
EXT_NET="iris-egress"      # normal bridge: proxy's path to the internet
INT_NET="iris-internal"    # --internal: sandbox lives here, no direct egress
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DC_DIR="$PROJECT_DIR/.devcontainer"

REBUILD=0
if [ "${1:-}" = "--rebuild" ]; then
    REBUILD=1
    shift
fi

if [ "$REBUILD" = "1" ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo ">>> Building $IMAGE..."
    # Bust the Claude Code layer on --rebuild so it re-fetches the latest release
    # (and any newly released models). A first-time build gets latest anyway.
    docker build --build-arg "CLAUDE_BUILD=$(date +%s)" -t "$IMAGE" "$DC_DIR"
fi
if [ "$REBUILD" = "1" ] || ! docker image inspect "$PROXY_IMAGE" >/dev/null 2>&1; then
    echo ">>> Building $PROXY_IMAGE..."
    docker build -t "$PROXY_IMAGE" "$DC_DIR/proxy"
fi
if [ "$REBUILD" = "1" ] || ! docker image inspect "$HEADROOM_IMAGE" >/dev/null 2>&1; then
    echo ">>> Building $HEADROOM_IMAGE..."
    docker build -t "$HEADROOM_IMAGE" "$DC_DIR/headroom"
fi

# Egress networks: EXT has internet, INT is isolated (--internal). The sandbox
# attaches only to INT; the proxy bridges INT -> EXT -> internet.
docker network inspect "$EXT_NET" >/dev/null 2>&1 || docker network create "$EXT_NET" >/dev/null
docker network inspect "$INT_NET" >/dev/null 2>&1 || docker network create --internal "$INT_NET" >/dev/null

# (Re)start the filtering proxy, attached to both networks. Recreated each launch
# so allowlist/config edits always take effect.
docker rm -f "$PROXY_NAME" >/dev/null 2>&1 || true
docker run -d --name "$PROXY_NAME" --hostname "$PROXY_NAME" \
    --restart unless-stopped \
    --network "$EXT_NET" \
    -v "$DC_DIR/proxy/tinyproxy.conf":/etc/tinyproxy/tinyproxy.conf:ro \
    -v "$DC_DIR/proxy/allowlist":/etc/tinyproxy/allowlist:ro \
    "$PROXY_IMAGE" >/dev/null
docker network connect "$INT_NET" "$PROXY_NAME"

PROXY_URL="http://${PROXY_NAME}:8888"
HEADROOM_URL="http://${HEADROOM_NAME}:8787"

# (Re)start the Headroom optimization proxy. Lives on the internal network only;
# the sandbox routes its Anthropic API traffic here (ANTHROPIC_BASE_URL) for
# token compression/caching, and Headroom forwards upstream to api.anthropic.com
# through the SAME filtering egress proxy (iris-proxy via HTTPS_PROXY) — so the
# egress allowlist still governs all outbound traffic. Recreated each launch so
# image/flag changes always take effect.
docker rm -f "$HEADROOM_NAME" >/dev/null 2>&1 || true
docker run -d --name "$HEADROOM_NAME" --hostname "$HEADROOM_NAME" \
    --restart unless-stopped \
    --network "$INT_NET" \
    -e HTTP_PROXY="$PROXY_URL" -e HTTPS_PROXY="$PROXY_URL" \
    -e http_proxy="$PROXY_URL" -e https_proxy="$PROXY_URL" \
    -e NO_PROXY="localhost,127.0.0.1" -e no_proxy="localhost,127.0.0.1" \
    "$HEADROOM_IMAGE" >/dev/null

# Named volumes keep the container's deps and caches off both the host filesystem
# and the host-built artifacts in the project tree:
#   iris-node-modules  -> /workspace/node_modules (NOT the host's, which is host-built)
#   iris-cargo-target  -> /opt/iris-target        (CARGO_TARGET_DIR, off the mount)
#   iris-cargo-registry-> /root/.cargo/registry   (warm crate cache)
#   iris-npm-cache     -> /root/.npm              (warm npm cache)
#   iris-pip-cache     -> /root/.cache/pip        (warm pip cache)
#   iris-playwright    -> /root/.cache/ms-playwright (downloaded browsers)
#   iris-claude        -> /root/.claude           (Claude auth)
for vol in iris-node-modules iris-cargo-target iris-cargo-registry \
           iris-npm-cache iris-pip-cache iris-playwright iris-claude; do
    docker volume create "$vol" >/dev/null
done

echo ">>> Starting sandbox (egress via ${PROXY_NAME}; Anthropic via ${HEADROOM_NAME}; project at /workspace)..."
# Heads-up: rootless Docker 29.5.x prints a bogus 'WARNING: IPv4 forwarding is
# disabled. Networking will not work.' It checks ip_forward in the host netns
# instead of the daemon's detached netns, where it is in fact enabled. Egress
# works (npm/pip/cargo download fine). Cosmetic-only; fixed upstream in 29.6.0.
# See https://github.com/moby/moby/issues/52737
echo ">>> (Ignore any 'IPv4 forwarding is disabled' line — cosmetic Docker 29.5.x"
echo "    rootless bug; egress works. moby#52737, fixed in 29.6.0.)"
exec docker run -it --rm \
    --name iris-sandbox \
    --hostname iris-sandbox \
    --network "$INT_NET" \
    -e HTTP_PROXY="$PROXY_URL" -e HTTPS_PROXY="$PROXY_URL" \
    -e http_proxy="$PROXY_URL" -e https_proxy="$PROXY_URL" \
    -e NO_PROXY="localhost,127.0.0.1,${HEADROOM_NAME}" \
    -e no_proxy="localhost,127.0.0.1,${HEADROOM_NAME}" \
    -e ANTHROPIC_BASE_URL="$HEADROOM_URL" \
    -e ENABLE_TOOL_SEARCH=true \
    -v "$PROJECT_DIR":/workspace \
    -v iris-node-modules:/workspace/node_modules \
    -v iris-cargo-target:/opt/iris-target \
    -v iris-cargo-registry:/root/.cargo/registry \
    -v iris-npm-cache:/root/.npm \
    -v iris-pip-cache:/root/.cache/pip \
    -v iris-playwright:/root/.cache/ms-playwright \
    -v iris-claude:/root/.claude \
    -w /workspace \
    "$IMAGE" "$@"
