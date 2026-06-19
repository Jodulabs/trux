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

test_ensure_env() {
  local sandbox
  sandbox="$(mktemp -d)"
  # shellcheck disable=SC1090
  source "$REPO/deploy/provision.sh"
  HOME="$sandbox" resolve_dirs
  HOME="$sandbox" ensure_env
  [ -f "$sandbox/.trux/.env" ] || fail "env file not created"
  grep -q "^TRUX_AUTH=1$" "$sandbox/.trux/.env" || fail "TRUX_AUTH missing"
  grep -Eq "^TRUX_SECRET=[0-9a-f]{64}$" "$sandbox/.trux/.env" || fail "TRUX_SECRET not a 32-byte hex"
  [ "$(stat -c '%a' "$sandbox/.trux/.env")" = "600" ] || fail "env file not chmod 600"
  local secret_before secret_after
  secret_before="$(grep '^TRUX_SECRET=' "$sandbox/.trux/.env")"
  HOME="$sandbox" ensure_env   # second run must not overwrite
  secret_after="$(grep '^TRUX_SECRET=' "$sandbox/.trux/.env")"
  [ "$secret_before" = "$secret_after" ] || fail "ensure_env overwrote existing secret"
  rm -rf "$sandbox"
  pass "ensure_env creates a 0600 env with a hex secret and is idempotent"
}

test_render_service
test_ensure_env
echo "ALL TESTS PASSED"
