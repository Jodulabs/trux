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
  NODE_DIR="/opt/node/bin"
  unit="$sandbox/trux.service"
  render_service "$unit"
  grep -q "^WorkingDirectory=/opt/example/trux$" "$unit" || fail "WorkingDirectory not substituted"
  grep -q "^ExecStart=/usr/local/bin/pnpm --filter backend start$" "$unit" || fail "ExecStart not substituted"
  grep -q "^Environment=PATH=/opt/node/bin:" "$unit" || fail "NODE_DIR not substituted into PATH"
  grep -q "__TRUX_DIR__\|__PNPM__\|__NODE_DIR__" "$unit" && fail "placeholder left in rendered unit"
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

test_shim_url_token() {
  local sandbox
  sandbox="$(mktemp -d)"
  mkdir -p "$sandbox/.trux"
  cat > "$sandbox/.trux/.env" <<EOF
TRUX_SECRET=deadbeef
TRUX_PORT=4317
TRUX_TAILSCALE_HOST=box.tail1234.ts.net
EOF
  local out
  out="$(HOME="$sandbox" bash "$REPO/bin/trux" token)"
  [ "$out" = "deadbeef" ] || fail "trux token returned '$out'"
  out="$(HOME="$sandbox" bash "$REPO/bin/trux" url)"
  [ "$out" = "https://box.tail1234.ts.net/" ] || fail "trux url returned '$out'"
  # TRUX_PUBLIC_HOST takes precedence over the tailnet host (Fly driver).
  echo 'TRUX_PUBLIC_HOST=myapp.fly.dev' >> "$sandbox/.trux/.env"
  out="$(HOME="$sandbox" bash "$REPO/bin/trux" url)"
  [ "$out" = "https://myapp.fly.dev/" ] || fail "trux url should prefer TRUX_PUBLIC_HOST, got '$out'"
  sed -i '/TRUX_PUBLIC_HOST/d' "$sandbox/.trux/.env"
  # No tailnet host -> local URL
  sed -i '/TRUX_TAILSCALE_HOST/d' "$sandbox/.trux/.env"
  out="$(HOME="$sandbox" bash "$REPO/bin/trux" url)"
  [ "$out" = "http://localhost:4317/" ] || fail "trux url (local) returned '$out'"
  rm -rf "$sandbox"
  pass "trux shim token/url read from env correctly"
}

test_uninstall_files() {
  local sandbox
  sandbox="$(mktemp -d)"
  # shellcheck disable=SC1090
  source "$REPO/deploy/uninstall.sh"
  # Seed a fake installation: shim, cloned code, and ~/.trux with a db.
  mkdir -p "$sandbox/.local/bin" "$sandbox/.local/share/trux" "$sandbox/.trux"
  : > "$sandbox/.local/bin/trux"
  : > "$sandbox/.local/share/trux/marker"
  : > "$sandbox/.trux/trux.db"
  HOME="$sandbox" resolve_dirs

  # Default: removes shim + code, KEEPS ~/.trux (token + history).
  HOME="$sandbox" uninstall_files
  [ -e "$sandbox/.local/bin/trux" ] && fail "shim not removed"
  [ -e "$sandbox/.local/share/trux" ] && fail "install dir not removed"
  [ -f "$sandbox/.trux/trux.db" ] || fail "TRUX_HOME deleted without --purge"

  # --purge: also removes ~/.trux.
  HOME="$sandbox" uninstall_files --purge
  [ -e "$sandbox/.trux" ] && fail "TRUX_HOME not removed with --purge"

  rm -rf "$sandbox"
  pass "uninstall_files removes shim+code, keeps ~/.trux unless --purge"
}

test_shim_resolve_install_dir() {
  # shellcheck disable=SC1090
  source "$REPO/bin/trux"
  local out
  # 1. Explicit override wins.
  out="$(TRUX_INSTALL_DIR=/custom/dir resolve_install_dir)"
  [ "$out" = "/custom/dir" ] || fail "TRUX_INSTALL_DIR override ignored: '$out'"
  # 2. The service's WorkingDirectory is used when it exists on disk.
  # (Name this differently from resolve_install_dir's own `local wd` — bash is
  #  dynamically scoped, so a shared name would let the stub read the wrong var.)
  local fake_wd; fake_wd="$(mktemp -d)"
  _service_workdir() { echo "$fake_wd"; }
  out="$(resolve_install_dir)"
  [ "$out" = "$fake_wd" ] || fail "service workdir not used: '$out'"
  rmdir "$fake_wd"
  # 3. Falls back to ~/.local/share/trux when the service workdir is empty/missing.
  _service_workdir() { echo ""; }
  out="$(HOME=/home/fake XDG_DATA_HOME='' resolve_install_dir)"
  [ "$out" = "/home/fake/.local/share/trux" ] || fail "fallback wrong: '$out'"
  pass "resolve_install_dir: override > service workdir > default"
}

test_shim_open() {
  local sandbox bindir
  sandbox="$(mktemp -d)"
  bindir="$sandbox/bin"
  mkdir -p "$bindir" "$sandbox/.trux"
  open_url_file="$sandbox/opened.txt"
  cat > "$bindir/xdg-open" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$1" > "$open_url_file"
EOF
  chmod +x "$bindir/xdg-open"
  cat > "$sandbox/.trux/.env" <<EOF
TRUX_SECRET=deadbeef
TRUX_PORT=4317
EOF
  HOME="$sandbox" PATH="$bindir:$PATH" bash "$REPO/bin/trux" open >/dev/null
  local out; out="$(cat "$open_url_file")"
  [ "$out" = "http://localhost:4317/#token=deadbeef" ] \
    || fail "trux open should xdg-open localhost URL with token in fragment, got '$out'"
  sed -i '/TRUX_SECRET/d' "$sandbox/.trux/.env"
  HOME="$sandbox" PATH="$bindir:$PATH" bash "$REPO/bin/trux" open >/dev/null
  out="$(cat "$open_url_file")"
  [ "$out" = "http://localhost:4317/" ] \
    || fail "trux open with no secret should pass bare localhost URL, got '$out'"
  rm -rf "$sandbox"
  pass "trux open constructs a localhost URL with token in the fragment"
}

test_ensure_flyctl_skip() {
  local sandbox stub; sandbox="$(mktemp -d)"; stub="$sandbox/bin"; mkdir -p "$stub"
  # flyctl already on PATH -> ensure_flyctl must NOT attempt a download.
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stub/flyctl"; chmod +x "$stub/flyctl"
  printf '#!/usr/bin/env bash\necho "curl should not run" >&2; exit 1\n' > "$stub/curl"; chmod +x "$stub/curl"
  # shellcheck disable=SC1090
  source "$REPO/deploy/provision.sh"
  PATH="$stub:$PATH" HOME="$sandbox" ensure_flyctl >/dev/null 2>&1 \
    || fail "ensure_flyctl should skip (succeed) when flyctl is already present"
  rm -rf "$sandbox"
  pass "ensure_flyctl skips the download when flyctl is already present"
}

test_render_service
test_ensure_env
test_shim_url_token
test_uninstall_files
test_shim_resolve_install_dir
test_shim_open
test_ensure_flyctl_skip
echo "ALL TESTS PASSED"
