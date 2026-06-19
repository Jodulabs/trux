#!/usr/bin/env bash
# Trux uninstaller. Removes the systemd service, the `trux` shim, and the cloned
# code. Keeps ~/.trux (your token + conversation history DB) unless --purge.
#   trux uninstall [--purge]      or      bash deploy/uninstall.sh [--purge]
# Self-contained on purpose: it deletes the install dir, so it must not source
# anything that lives there.
set -euo pipefail

resolve_dirs() {
  INSTALL_DIR="${TRUX_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/trux}"
  SERVICE_DST="$HOME/.config/systemd/user/trux.service"
  SHIM_DST="$HOME/.local/bin/trux"
  TRUX_HOME="$HOME/.trux"
  export INSTALL_DIR SERVICE_DST SHIM_DST TRUX_HOME
}

uninstall_service() {
  systemctl --user stop trux.service 2>/dev/null || true
  systemctl --user disable trux.service 2>/dev/null || true
  rm -f "$SERVICE_DST"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "trux: stopped and removed the systemd service"
  # Linger is a shared user-session setting (other services may rely on it), so we
  # leave it enabled rather than silently reverse it.
  echo "trux: note — login linger left enabled (disable with: loginctl disable-linger \"\$(whoami)\")"
}

uninstall_tailscale() {
  if command -v tailscale &>/dev/null; then
    # New CLI clears serve with `serve reset`; older releases used `--https=443 off`.
    tailscale serve reset 2>/dev/null || tailscale serve --https=443 off 2>/dev/null || true
    echo "trux: cleared tailscale serve"
  fi
}

uninstall_files() {
  local purge="${1:-}"
  rm -f "$SHIM_DST"
  rm -rf "$INSTALL_DIR"
  echo "trux: removed shim and code ($INSTALL_DIR)"
  if [[ "$purge" == "--purge" ]]; then
    rm -rf "$TRUX_HOME"
    echo "trux: purged $TRUX_HOME (token + conversation history)"
  else
    echo "trux: kept $TRUX_HOME (token + conversation history) — re-run with --purge to delete it"
  fi
}

main() {
  resolve_dirs
  # We're about to delete INSTALL_DIR; if this script lives there, re-exec from a
  # temp copy first so we are not reading the file we're removing.
  if [[ "${TRUX_UNINSTALL_RELOCATED:-}" != "1" && "$0" == "$INSTALL_DIR"/* ]]; then
    local tmp
    tmp="$(mktemp)"
    cp "$0" "$tmp"
    TRUX_UNINSTALL_RELOCATED=1 exec bash "$tmp" "$@"
  fi
  uninstall_service
  uninstall_tailscale
  uninstall_files "${1:-}"
  echo ""
  echo "  ✅ trux uninstalled."
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
