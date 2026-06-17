# Headroom optimization proxy for the Iris sandbox.
#
# Runs Headroom (https://pypi.org/project/headroom-ai/) as a standalone proxy in
# its OWN container, so the sandbox's Claude can route Anthropic API traffic
# through it for token compression/caching WITHOUT baking headroom and its
# dependency stack (litellm, httpx, …) into the sandbox image.
#
# Topology (wired up by run-sandbox.sh): this container sits on the --internal
# `iris-internal` network alongside the sandbox. The sandbox points
# ANTHROPIC_BASE_URL at it; it forwards upstream to api.anthropic.com through the
# same filtering egress proxy (`iris-proxy`) the sandbox uses (HTTPS_PROXY), so
# the egress allowlist still governs ALL outbound traffic.
#
# No headroom MCP is registered in the sandbox's Claude (that would mean
# installing headroom in the sandbox). Instead we rely on Headroom's CCR
# tool-injection: the proxy injects its `headroom_retrieve` tool into the request
# and resolves the tool-call server-side, so compressed content stays
# re-expandable WITHOUT a client-side MCP. (Do NOT pass --no-ccr-inject-tool /
# --no-ccr-marker: in headroom 0.26.0 that path hits an UnboundLocalError on
# `ccr_workspace_key` and every request 500s — which looks like "API not
# reachable" from inside the sandbox.)
FROM python:3.12-slim

# Build-time has full internet (only the sandbox's RUN-time egress is proxied),
# so pip can fetch freely here. Pin to the version used on the host for
# reproducibility; override with --build-arg HEADROOM_VERSION=… on rebuild.
# The `[proxy]` extra pulls in the proxy server deps (fastapi, uvicorn, …);
# the bare package is CLI-only and `headroom proxy` would refuse to start.
ARG HEADROOM_VERSION=0.26.0
RUN pip install --no-cache-dir "headroom-ai[proxy]==${HEADROOM_VERSION}"

# Listen on all interfaces so the sandbox container can reach it by name.
EXPOSE 8787

# --stateless: no filesystem writes (safe for a throwaway proxy container).
# --no-telemetry: no phone-home (the egress allowlist blocks it anyway).
ENTRYPOINT ["headroom", "proxy", \
            "--host", "0.0.0.0", "--port", "8787", \
            "--stateless", "--no-telemetry"]
