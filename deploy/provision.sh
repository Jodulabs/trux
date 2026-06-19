#!/usr/bin/env bash
# Trux provisioning core. Sourceable: `main` only runs when executed directly.
# Builds the frontend, writes ~/.trux/.env, installs the systemd user service,
# the `trux` shim, and configures Tailscale serve. Paths are derived from this
# file's own location, so it works wherever the repo was cloned.
set -euo pipefail

# Where this script (and its sibling template) live — resolved at source time so
# it is independent of the substituted TRUX_DIR value (lets tests substitute an
# arbitrary path while still reading the real template).
TRUX_PROVISION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_dirs() {
  TRUX_DIR="${TRUX_DIR:-$(cd "$TRUX_PROVISION_DIR/.." && pwd)}"
  ENV_FILE="$HOME/.trux/.env"
  SERVICE_DST="$HOME/.config/systemd/user/trux.service"
  SHIM_DST="$HOME/.local/bin/trux"
  PNPM_BIN="${PNPM_BIN:-$(command -v pnpm)}"
  # The dir holding the node that should run trux. pnpm (#!/usr/bin/env node) and node
  # are siblings under every version manager (pi-node/nvm/fnm/volta), so this one dir
  # on the unit's PATH makes systemd use the right node instead of the system one.
  NODE_DIR="${NODE_DIR:-$(dirname "$(command -v node)")}"
  # ENV_FILE/SERVICE_DST/SHIM_DST are consumed by ensure_env/render/install_shim/main below.
  export ENV_FILE SERVICE_DST SHIM_DST
}

render_service() {
  # $1 = output path. Substitutes the template's placeholders with TRUX_DIR/PNPM_BIN.
  local out="$1"
  mkdir -p "$(dirname "$out")"
  sed -e "s|__TRUX_DIR__|$TRUX_DIR|g" \
      -e "s|__PNPM__|$PNPM_BIN|g" \
      -e "s|__NODE_DIR__|$NODE_DIR|g" \
      "$TRUX_PROVISION_DIR/trux.service.template" > "$out"
}

ensure_env() {
  if [[ -f "$ENV_FILE" ]]; then
    echo "trux: $ENV_FILE exists — keeping it"
    return 0
  fi
  mkdir -p "$(dirname "$ENV_FILE")"
  local secret ts_host
  secret="$(openssl rand -hex 32)"
  ts_host="$(tailscale status --json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null || echo "")"
  cat > "$ENV_FILE" <<EOF
TRUX_AUTH=1
TRUX_SECRET=$secret
TRUX_HOST=127.0.0.1
TRUX_PORT=4317
TRUX_WORKSPACES=$HOME
TRUX_TAILSCALE_HOST=$ts_host
EOF
  chmod 0600 "$ENV_FILE"
  echo "trux: wrote $ENV_FILE (edit TRUX_WORKSPACES / TRUX_TAILSCALE_HOST as needed)"
}

install_shim() {
  mkdir -p "$(dirname "$SHIM_DST")"
  install -m 0755 "$TRUX_DIR/bin/trux" "$SHIM_DST"
  case ":$PATH:" in
    *":$(dirname "$SHIM_DST"):"*) ;;
    *) echo "trux: add $(dirname "$SHIM_DST") to your PATH to use the 'trux' command" ;;
  esac
}

setup_tailscale() {
  if command -v tailscale &>/dev/null; then
    tailscale serve --bg https / http://127.0.0.1:4317 2>/dev/null \
      && echo "trux: tailscale serve configured" \
      || echo "trux: tailscale serve failed (run 'tailscale up' first?) — skipping"
  else
    echo "trux: tailscale not found — skipping remote setup (local only)"
  fi
}

print_banner() {
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  echo ""
  echo "  ✅ trux installed and running."
  echo "     local:  http://localhost:${TRUX_PORT:-4317}/"
  [[ -n "${TRUX_TAILSCALE_HOST:-}" ]] && echo "     phone:  https://${TRUX_TAILSCALE_HOST}/"
  echo "     token:  ${TRUX_SECRET:-<see ~/.trux/.env>}"
  echo ""
  echo "  Manage:  trux status | trux logs | trux restart | trux update"
  echo "  Pair a phone (QR):  trux pair"
  echo ""
}

main() {
  resolve_dirs
  echo "trux: provisioning from $TRUX_DIR"
  echo "trux: installing dependencies..."
  pnpm -C "$TRUX_DIR" install --frozen-lockfile
  echo "trux: building frontend..."
  pnpm -C "$TRUX_DIR" --filter frontend build
  ensure_env
  render_service "$SERVICE_DST"
  install_shim
  loginctl enable-linger "$(whoami)" >/dev/null 2>&1 || true
  systemctl --user daemon-reload
  systemctl --user enable --now trux.service
  setup_tailscale
  print_banner
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
