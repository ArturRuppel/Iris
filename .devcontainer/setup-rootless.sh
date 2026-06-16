#!/usr/bin/env bash
# Migrate the sandbox from rootful Docker (root daemon + docker group) to
# ROOTLESS Docker (daemon runs as your user). After this, no process of yours
# has the root-equivalent docker-group access.
#
# Run as your normal user, NOT with sudo (it calls sudo only where needed):
#     bash .devcontainer/setup-rootless.sh
#
# It verifies rootless works BEFORE disabling the rootful daemon / removing the
# group, so a failure leaves your current setup intact.
set -euo pipefail

if [ "$(id -u)" = 0 ]; then
    echo "!! Run as your normal user (not root/sudo)."; exit 1
fi
USER_NAME="$(id -un)"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DOCKER_HOST="unix://${XDG_RUNTIME_DIR}/docker.sock"
export PATH="/usr/bin:${PATH}"

echo "==> [1/5] Prerequisites (sudo): uidmap, slirp4netns, AppArmor, linger"
sudo apt-get update
sudo apt-get install -y uidmap slirp4netns
# The rootlesskit AppArmor profile ships with docker-ce-rootless-extras; (re)load
# it so unprivileged user namespaces are permitted under Ubuntu 24.04's policy.
if [ -f /etc/apparmor.d/rootlesskit ]; then
    sudo apparmor_parser -r -W /etc/apparmor.d/rootlesskit || true
fi
# Keep the rootless daemon alive even when you're not logged in.
sudo loginctl enable-linger "$USER_NAME"

echo "==> [2/5] Installing rootless Docker (user systemd service)"
dockerd-rootless-setuptool.sh install

echo "==> [3/5] Waiting for the rootless daemon to come up..."
ok=0
for _ in $(seq 1 15); do
    if docker -H "$DOCKER_HOST" info >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
done
if [ "$ok" != 1 ]; then
    echo "!! Rootless daemon did not start. Rootful Docker is untouched. Inspect:"
    echo "   systemctl --user status docker.service"
    exit 1
fi

echo "==> [4/5] Verifying rootless container run (hello-world)"
docker -H "$DOCKER_HOST" run --rm hello-world >/dev/null
echo "    rootless Docker works."

echo "==> [5/5] Tightening: disable rootful daemon + leave docker group"
sudo systemctl disable --now docker.service docker.socket 2>/dev/null || true
sudo gpasswd -d "$USER_NAME" docker 2>/dev/null || true

echo
echo "============================================================"
echo " Rootless Docker is active. The root-equivalent docker group"
echo " membership has been removed (takes full effect after your"
echo " next logout/login)."
echo
echo " The launcher sets DOCKER_HOST automatically. For ad-hoc"
echo " 'docker' commands in your shell, add to ~/.bashrc:"
echo "   export DOCKER_HOST=unix://\$XDG_RUNTIME_DIR/docker.sock"
echo
echo " Start the sandbox:  ./.devcontainer/run-sandbox.sh"
echo "============================================================"
