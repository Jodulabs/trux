#!/usr/bin/env bash
# Sandboxed tests for the installer. Each test runs against a throwaway $HOME.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

test_render_service() {
  local sandbox unit
  sandbox="$(mktemp -d)"
  # shellcheck disable=SC1090
  source "$REPO/deploy/provision.sh"
  TRUX_DIR="/opt/example/trux"
  PNPM_BIN="/usr/local/bin/pnpm"
  unit="$sandbox/trux.service"
  render_service "$unit"
  grep -q "^WorkingDirectory=/opt/example/trux$" "$unit" || fail "WorkingDirectory not substituted"
  grep -q "^ExecStart=/usr/local/bin/pnpm --filter backend start$" "$unit" || fail "ExecStart not substituted"
  grep -q "__TRUX_DIR__\|__PNPM__" "$unit" && fail "placeholder left in rendered unit"
  rm -rf "$sandbox"
  pass "render_service substitutes paths and leaves no placeholders"
}

test_render_service
echo "ALL TESTS PASSED"
