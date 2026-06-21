#!/usr/bin/env bash
# shellcheck disable=SC2030,SC2031
# Sandboxed tests for the Fly driver. Each test runs against a throwaway dir with
# stubbed git/fly/pnpm on PATH — no real Fly account or Docker needed.
# (SC2030/31 disabled file-wide: each test scopes its env to a subshell on purpose.)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

test_materialize_env() {
  local sandbox; sandbox="$(mktemp -d)"
  if ! (
    # shellcheck disable=SC1090
    source "$REPO/deploy/fly/entrypoint.sh"
    export TRUX_DATA_DIR="$sandbox/data"
    unset TRUX_HOST TRUX_PORT TRUX_WORKSPACES TRUX_DB_PATH TRUX_AUTH
    materialize_env
    [ "$TRUX_HOST" = "0.0.0.0" ] || fail "TRUX_HOST default wrong: ${TRUX_HOST:-}"
    [ "$TRUX_WORKSPACES" = "$sandbox/data" ] || fail "workspace not the volume: ${TRUX_WORKSPACES:-}"
    [ "$TRUX_AUTH" = "1" ] || fail "auth should default on for a public box: ${TRUX_AUTH:-}"
    [ -d "$(dirname "$TRUX_DB_PATH")" ] || fail "db dir not created under the volume"
  ); then rm -rf "$sandbox"; exit 1; fi
  rm -rf "$sandbox"
  pass "materialize_env points trux at the volume and defaults auth on"
}

test_ensure_repo_idempotent() {
  local sandbox stub; sandbox="$(mktemp -d)"; stub="$sandbox/bin"; mkdir -p "$stub"
  mkdir -p "$sandbox/data/myrepo/.git"
  # A git that errors if invoked — proves ensure_repo does NOT clone over existing work.
  printf '#!/usr/bin/env bash\necho "git should not run" >&2; exit 1\n' > "$stub/git"
  chmod +x "$stub/git"
  if ! (
    # shellcheck disable=SC1090
    source "$REPO/deploy/fly/entrypoint.sh"
    export PATH="$stub:$PATH" TRUX_DATA_DIR="$sandbox/data" TRUX_REPO_URL="https://github.com/me/myrepo.git"
    ensure_repo
  ); then rm -rf "$sandbox"; fail "ensure_repo cloned over an existing repo"; fi
  rm -rf "$sandbox"
  pass "ensure_repo keeps an existing repo (no clobber on auto-start)"
}

test_ensure_repo_clones() {
  local sandbox stub; sandbox="$(mktemp -d)"; stub="$sandbox/bin"; mkdir -p "$stub"
  # A git stub that just makes the destination look cloned, recording the auth'd URL.
  cat > "$stub/git" <<'GIT'
#!/usr/bin/env bash
# args: clone <url> <dest>
mkdir -p "$3/.git"
echo "$2" > "$3.url"
GIT
  chmod +x "$stub/git"
  if ! (
    # shellcheck disable=SC1090
    source "$REPO/deploy/fly/entrypoint.sh"
    export PATH="$stub:$PATH" TRUX_DATA_DIR="$sandbox/data" \
           TRUX_REPO_URL="https://github.com/me/app.git" GITHUB_TOKEN="ghtok"
    ensure_repo
    [ -d "$sandbox/data/app/.git" ] || fail "repo not cloned to the volume"
    grep -q "x-access-token:ghtok@github.com/me/app.git" "$sandbox/data/app.url" \
      || fail "GITHUB_TOKEN not injected into the clone URL"
  ); then rm -rf "$sandbox"; exit 1; fi
  rm -rf "$sandbox"
  pass "ensure_repo clones a private repo using GITHUB_TOKEN"
}

test_materialize_env
test_ensure_repo_idempotent
test_ensure_repo_clones
echo "ALL FLY TESTS PASSED"
