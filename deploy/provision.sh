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
  # ENV_FILE/SERVICE_DST/SHIM_DST are consumed by ensure_env/render/install_shim/main below.
  export ENV_FILE SERVICE_DST SHIM_DST
}

render_service() {
  # $1 = output path. Substitutes the template's placeholders with TRUX_DIR/PNPM_BIN.
  local out="$1"
  mkdir -p "$(dirname "$out")"
  sed -e "s|__TRUX_DIR__|$TRUX_DIR|g" \
      -e "s|__PNPM__|$PNPM_BIN|g" \
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

main() {
  resolve_dirs
  echo "trux: provisioning from $TRUX_DIR"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
