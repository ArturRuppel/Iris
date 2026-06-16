#!/usr/bin/env bash
# One-time HOST setup for the Iris sandbox (rootful path, kept for reference).
#
# Prefer setup-rootless.sh — the sandbox is designed to run against ROOTLESS
# Docker. This script installs the rootFUL Docker Engine and adds you to the
# `docker` group, which is root-equivalent; use it only if you specifically want
# the rootful daemon. Iris needs no GPU, so (unlike the upstream CellFlow
# version) this no longer installs the NVIDIA Container Toolkit.
#
# Run it WITHOUT sudo (it calls sudo internally so $USER stays correct):
#     bash .devcontainer/install-host-deps.sh
#
# It is idempotent — safe to re-run.
set -euo pipefail

USER_NAME="$(id -un)"
CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
ARCH="$(dpkg --print-architecture)"

echo "==> [1/2] Installing Docker Engine (codename=$CODENAME arch=$ARCH)..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
fi
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> [2/2] Adding '$USER_NAME' to the docker group..."
sudo usermod -aG docker "$USER_NAME"

echo
echo "============================================================"
echo " Host setup complete (rootful Docker)."
echo
echo " IMPORTANT: log out and back in (or reboot) so your user picks up the"
echo " 'docker' group, then restart Claude Code. After that, the sandbox runs"
echo " without sudo via:   ./.devcontainer/run-sandbox.sh"
echo
echo " For the safer rootless setup instead, run:"
echo "   bash .devcontainer/setup-rootless.sh"
echo "============================================================"
