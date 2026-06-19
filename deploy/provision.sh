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

main() {
  resolve_dirs
  echo "trux: provisioning from $TRUX_DIR"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
