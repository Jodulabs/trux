#!/usr/bin/env bash
# Trux one-line installer:
#   curl -fsSL https://raw.githubusercontent.com/Jodulabs/trux/main/install.sh | bash
# Clones (or updates) trux into ~/.local/share/trux and provisions it.
set -euo pipefail

REPO_URL="${TRUX_REPO_URL:-https://github.com/Jodulabs/trux.git}"
BRANCH="${TRUX_BRANCH:-main}"
INSTALL_DIR="${TRUX_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/trux}"

die() { echo "trux install: $*" >&2; exit 1; }
have() { command -v "$1" &>/dev/null; }

echo "trux installer"
echo "  repo:   $REPO_URL ($BRANCH)"
echo "  target: $INSTALL_DIR"

# --- preflight ---
have git || die "git is required (install git and re-run)"

if ! have node; then
  die "Node.js >= 22 is required (https://nodejs.org or use a version manager)"
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 22 ]] || die "Node >= 22 required, found $(node -v)"

if ! have pnpm; then
  if have corepack; then
    echo "trux: enabling pnpm via corepack"
    corepack enable >/dev/null 2>&1 || die "corepack enable failed; install pnpm manually"
  else
    die "pnpm is required (run: npm i -g pnpm, or enable corepack)"
  fi
fi

have tailscale || echo "trux: WARNING tailscale not found — phone/remote access won't work until installed"
have claude    || echo "trux: WARNING 'claude' CLI not found — the default agent needs it logged in on this box"

# --- fetch code ---
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "trux: updating existing checkout"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  echo "trux: cloning"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

# --- provision ---
exec bash "$INSTALL_DIR/deploy/provision.sh"
