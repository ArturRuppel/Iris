# Iris autonomous dev sandbox image.
#
# Runs as root *inside* the container. Under rootless Docker (how this is run),
# container-root maps to your unprivileged host user, so:
#   * files created in the bind-mounted /workspace are owned by you on the host
#     (a non-root container user would map to an unwritable host subuid), and
#   * there is no host privilege escalation — container-root != host-root.
#
# Iris is a Tauri (Rust) + Vite/React/TS desktop app with a Python (FastAPI)
# analysis engine. This image carries all three toolchains so the agent can
# build the frontend, run the engine + its pytest suite, and `cargo build` the
# Tauri shell. The desktop GUI itself can't run here (no display); launch the
# actual app on the host.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/root \
    # We run as container-root (required so rootless maps /workspace writes back
    # to the host user). Claude refuses --dangerously-skip-permissions as root
    # unless it knows it's sandboxed; this container genuinely is one.
    IS_SANDBOX=1 \
    # Rust: keep toolchains/registry under /root so a warm registry cache volume
    # speeds rebuilds, and redirect build artifacts OFF the bind mount so the
    # container never clobbers the host's src-tauri/target (built for the host).
    CARGO_HOME=/root/.cargo \
    RUSTUP_HOME=/root/.rustup \
    CARGO_TARGET_DIR=/opt/iris-target \
    # Playwright browser binaries live at a stable, volume-backed path.
    PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright \
    # venv first so `python`/`pip` resolve to the engine env; then cargo, then
    # Claude Code (~/.local/bin) and node (/usr/bin, via NodeSource).
    PATH=/opt/iris-venv/bin:/root/.cargo/bin:/root/.local/bin:/usr/bin:$PATH

# System deps:
#  - build-essential/pkg-config/git/curl/wget/file/ca-certificates: tooling + builds
#  - python3/-venv/-dev + libssl-dev: the FastAPI engine and its wheels
#  - Tauri v2 Linux libs: libwebkit2gtk-4.1-dev, libgtk-3-dev, librsvg2-dev,
#    libayatana-appindicator3-dev, libxdo-dev (the `tauri` crate links these even
#    for a headless `cargo build`)
#  - Playwright/Chromium runtime libs + xvfb: so the e2e suite's headless
#    chromium has the shared libraries and an X server fallback it needs
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        wget \
        file \
        git \
        pkg-config \
        python3 \
        python3-venv \
        python3-dev \
        python3-pip \
        libssl-dev \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        librsvg2-dev \
        libayatana-appindicator3-dev \
        libxdo-dev \
        libnss3 \
        libnspr4 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2t64 \
        libatspi2.0-0 \
        xvfb \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/iris-target /root/.cargo/registry /root/.npm \
                /root/.cache/pip /root/.cache/ms-playwright /root/.claude

# Node.js 20 (matches the host) from NodeSource. Build-time has full internet
# (only RUN-time egress is proxied), so fetching the setup script is fine here.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust via rustup (stable). cargo/rustc land in /root/.cargo/bin (already on PATH).
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --default-toolchain stable --profile minimal

# Engine venv, kept OFF the bind mount so it never collides with the host's
# Python env. Deps are installed at startup from the committed lock (see
# sandbox-entry.sh) rather than baked in, so a lock bump needs no image rebuild;
# a warm pip cache (named volume) keeps that install near-instant.
RUN python3 -m venv /opt/iris-venv \
    && /opt/iris-venv/bin/pip install --upgrade pip

# Helper scripts.
COPY sandbox-entry.sh /usr/local/bin/sandbox-entry.sh
COPY runtests.sh /usr/local/bin/runtests
RUN chmod 0755 /usr/local/bin/sandbox-entry.sh /usr/local/bin/runtests

WORKDIR /workspace

# Claude Code, in its own layer with a cache-busting arg. The install script
# always fetches the latest release, but Docker would otherwise reuse the cached
# layer forever and pin you to whatever version first built the image. Passing a
# changing --build-arg CLAUDE_BUILD=... (run-sandbox.sh --rebuild does this)
# invalidates only this layer, so a rebuild re-fetches the newest Claude — which
# is what unlocks newly released models.
ARG CLAUDE_BUILD=1
RUN curl -fsSL https://claude.ai/install.sh | bash

ENTRYPOINT ["/usr/local/bin/sandbox-entry.sh"]
