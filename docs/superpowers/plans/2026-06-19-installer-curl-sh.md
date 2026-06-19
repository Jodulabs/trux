# Trux Installer (curl | sh) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone install trux on a fresh Linux box with one command — `curl -fsSL https://raw.githubusercontent.com/Jodulabs/trux/main/install.sh | bash` — with no manual `git clone`, no hand-edited paths, and the backend auto-starting as a systemd user service.

**Architecture:** A standalone `install.sh` (the curl target) does preflight + clones/updates the public repo into `~/.local/share/trux`, then hands off to `deploy/provision.sh`. `provision.sh` is the shared, sourceable core (build → env → service → tailscale → shim) that derives its own paths from its location, so nothing is hardcoded to one user's home. `deploy/setup.sh` (the existing "I already have a checkout" entry) is refactored to delegate to `provision.sh` so there is one implementation. A `bin/trux` shim gives `status|restart|logs|update|token|url|pair`. A root `README.md` documents the one-liner.

**Tech Stack:** Bash (set -euo pipefail), systemd `--user` units + linger, pnpm 11 / Node 22, Tailscale serve, shellcheck for static checks, a sandboxed bash test harness (`deploy/test_install.sh`) in place of vitest for shell.

**Testing discipline (shell adaptation of TDD):** there is no good unit-test runner for a curl-bootstrap installer, and adding `bats` is YAGNI for a personal tool. Instead: (a) every shell file must pass `shellcheck -x` clean, and (b) the pure, side-effect-contained functions in `provision.sh` and `bin/trux` are exercised by `deploy/test_install.sh`, which runs them against a throwaway `$HOME` (a `mktemp -d`) and asserts on the files/output they produce. Each task writes the failing assertion first, runs it to see it fail, then implements.

**Conventions used throughout:**
- Install dir: `${TRUX_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/trux}`
- Env file: `$HOME/.trux/.env` (mode 0600)
- Shim: `$HOME/.local/bin/trux`
- Repo: `https://github.com/Jodulabs/trux.git`, branch `main`
- `provision.sh` is **sourceable**: its `main` only runs when executed directly, guarded by `if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi`, so the test harness can `source` it and call individual functions.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `install.sh` | create (repo root) | curl entrypoint: preflight (git/node/pnpm), clone-or-pull into install dir, exec `deploy/provision.sh`. Self-contained — runs before the repo exists locally. |
| `deploy/provision.sh` | create | shared core, sourceable. Functions: `resolve_dirs`, `render_service`, `ensure_env`, `install_shim`, `setup_tailscale`, `print_banner`, `main`. Derives `TRUX_DIR` from its own location → no hardcoded paths. |
| `deploy/trux.service.template` | create | systemd unit with `__TRUX_DIR__` and `__PNPM__` placeholders, substituted by `render_service`. |
| `bin/trux` | create | management shim: `status|start|stop|restart|logs|update|token|url|pair`. |
| `deploy/setup.sh` | modify | becomes a thin wrapper that execs `provision.sh` (DRY). Keeps the "already cloned, set me up" entry working. |
| `deploy/trux.service` | delete | replaced by the template; the old file hardcodes `%h/dreamLand/jodulabs/trux`. |
| `deploy/test_install.sh` | create | sandboxed test harness (shellcheck + function-level assertions). |
| `README.md` | create (repo root) | one-line install, prerequisites, `trux` command reference, uninstall. |

---

## Task 1: systemd unit template (kill the hardcoded path)

**Files:**
- Create: `deploy/trux.service.template`
- Delete: `deploy/trux.service`

- [ ] **Step 1: Write the template**

Create `deploy/trux.service.template`:

```ini
[Unit]
Description=Trux backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=__TRUX_DIR__
EnvironmentFile=%h/.trux/.env
ExecStart=__PNPM__ --filter backend start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

- [ ] **Step 2: Remove the old hardcoded unit**

Run: `git rm deploy/trux.service`
Expected: `rm 'deploy/trux.service'`

- [ ] **Step 3: Verify no stray references to the old file remain**

Run: `grep -rn "trux.service" deploy/ --include='*.sh' | grep -v template`
Expected: no output (no script still copies the old non-template file). If `setup.sh` still references `deploy/trux.service`, that is fine for now — Task 5 rewrites it.

- [ ] **Step 4: Commit**

```bash
git add deploy/trux.service.template
git commit -m "feat(deploy): templated systemd unit, drop hardcoded WorkingDirectory"
```

---

## Task 2: provision core — `resolve_dirs` + `render_service`

**Files:**
- Create: `deploy/provision.sh`
- Create: `deploy/test_install.sh`

- [ ] **Step 1: Write the failing test for `render_service`**

Create `deploy/test_install.sh`:

```bash
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/test_install.sh`
Expected: FAIL — `deploy/provision.sh` does not exist yet (source error / "No such file").

- [ ] **Step 3: Write the minimal `provision.sh` with `resolve_dirs` + `render_service`**

Create `deploy/provision.sh`:

```bash
#!/usr/bin/env bash
# Trux provisioning core. Sourceable: `main` only runs when executed directly.
# Builds the frontend, writes ~/.trux/.env, installs the systemd user service,
# the `trux` shim, and configures Tailscale serve. Paths are derived from this
# file's own location, so it works wherever the repo was cloned.
set -euo pipefail

resolve_dirs() {
  TRUX_DIR="${TRUX_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  ENV_FILE="$HOME/.trux/.env"
  SERVICE_DST="$HOME/.config/systemd/user/trux.service"
  SHIM_DST="$HOME/.local/bin/trux"
  PNPM_BIN="${PNPM_BIN:-$(command -v pnpm)}"
}

render_service() {
  # $1 = output path. Substitutes the template's placeholders.
  local out="$1"
  mkdir -p "$(dirname "$out")"
  sed -e "s|__TRUX_DIR__|$TRUX_DIR|g" \
      -e "s|__PNPM__|$PNPM_BIN|g" \
      "$TRUX_DIR/deploy/trux.service.template" > "$out"
}

main() {
  resolve_dirs
  echo "trux: provisioning from $TRUX_DIR"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash deploy/test_install.sh`
Expected: `PASS: render_service ...` then `ALL TESTS PASSED`.

- [ ] **Step 5: Static check**

Run: `shellcheck -x deploy/provision.sh deploy/test_install.sh`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add deploy/provision.sh deploy/test_install.sh
git commit -m "feat(deploy): provision core with templated service render + test harness"
```

---

## Task 3: provision — `ensure_env` (idempotent secret/config)

**Files:**
- Modify: `deploy/provision.sh`
- Modify: `deploy/test_install.sh`

- [ ] **Step 1: Add the failing test for `ensure_env`**

In `deploy/test_install.sh`, add this function and call it before the final echo:

```bash
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
```

Add `test_ensure_env` on the line above `echo "ALL TESTS PASSED"`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/test_install.sh`
Expected: FAIL — `ensure_env: command not found` (function not defined yet).

- [ ] **Step 3: Implement `ensure_env`**

In `deploy/provision.sh`, add this function after `render_service`:

```bash
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash deploy/test_install.sh`
Expected: both `PASS:` lines, then `ALL TESTS PASSED`.

- [ ] **Step 5: Static check**

Run: `shellcheck -x deploy/provision.sh deploy/test_install.sh`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add deploy/provision.sh deploy/test_install.sh
git commit -m "feat(deploy): idempotent ~/.trux/.env generation in provision"
```

---

## Task 4: provision — `install_shim`, `setup_tailscale`, `print_banner`, `main`

**Files:**
- Modify: `deploy/provision.sh`

- [ ] **Step 1: Implement the remaining functions**

In `deploy/provision.sh`, add after `ensure_env`:

```bash
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
```

- [ ] **Step 2: Replace `main` to run the full sequence**

In `deploy/provision.sh`, replace the existing `main` with:

```bash
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
```

- [ ] **Step 3: Static check (no functional run — this touches systemd)**

Run: `shellcheck -x deploy/provision.sh`
Expected: clean.

- [ ] **Step 4: Verify the existing function tests still pass**

Run: `bash deploy/test_install.sh`
Expected: `ALL TESTS PASSED` (the new functions have side effects on the real system, so they are covered by the Task 8 integration run, not the sandbox harness).

- [ ] **Step 5: Commit**

```bash
git add deploy/provision.sh
git commit -m "feat(deploy): provision shim/tailscale/banner + full main sequence"
```

---

## Task 5: refactor `deploy/setup.sh` to delegate (DRY)

**Files:**
- Modify: `deploy/setup.sh`

- [ ] **Step 1: Replace setup.sh with a thin delegator**

Overwrite `deploy/setup.sh`:

```bash
#!/usr/bin/env bash
# Provision trux from an existing checkout. Delegates to the shared core so there
# is one implementation (see deploy/provision.sh). For a from-scratch install on
# a new box, use the one-liner in README.md instead.
set -euo pipefail
exec bash "$(cd "$(dirname "$0")" && pwd)/provision.sh" "$@"
```

- [ ] **Step 2: Static check**

Run: `shellcheck -x deploy/setup.sh`
Expected: clean.

- [ ] **Step 3: Verify it resolves to provision.sh**

Run: `bash -n deploy/setup.sh && grep -q 'provision.sh' deploy/setup.sh && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add deploy/setup.sh
git commit -m "refactor(deploy): setup.sh delegates to provision.sh"
```

---

## Task 6: the `trux` management shim

**Files:**
- Create: `bin/trux`
- Modify: `deploy/test_install.sh`

- [ ] **Step 1: Add failing tests for `trux url` and `trux token`**

In `deploy/test_install.sh`, add and call before the final echo:

```bash
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
  # No tailnet host -> local URL
  sed -i '/TRUX_TAILSCALE_HOST/d' "$sandbox/.trux/.env"
  out="$(HOME="$sandbox" bash "$REPO/bin/trux" url)"
  [ "$out" = "http://localhost:4317/" ] || fail "trux url (local) returned '$out'"
  rm -rf "$sandbox"
  pass "trux shim token/url read from env correctly"
}
```

Add `test_shim_url_token` above `echo "ALL TESTS PASSED"`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/test_install.sh`
Expected: FAIL — `bin/trux` does not exist.

- [ ] **Step 3: Write `bin/trux`**

Create `bin/trux`:

```bash
#!/usr/bin/env bash
# Trux management shim. Installed to ~/.local/bin/trux by the installer.
set -euo pipefail
ENV_FILE="$HOME/.trux/.env"
INSTALL_DIR="${TRUX_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/trux}"

envval() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }

cmd="${1:-status}"
case "$cmd" in
  status)  systemctl --user status trux.service --no-pager ;;
  start)   systemctl --user start trux.service ;;
  stop)    systemctl --user stop trux.service ;;
  restart) systemctl --user restart trux.service && echo "trux: restarted" ;;
  logs)    journalctl --user -u trux.service -f ;;
  update)
    git -C "$INSTALL_DIR" pull --ff-only
    pnpm -C "$INSTALL_DIR" install --frozen-lockfile
    pnpm -C "$INSTALL_DIR" --filter frontend build
    systemctl --user restart trux.service
    echo "trux: updated and restarted" ;;
  token)   envval TRUX_SECRET ;;
  url)
    host="$(envval TRUX_TAILSCALE_HOST)"
    if [[ -n "$host" ]]; then echo "https://$host/"; else echo "http://localhost:$(envval TRUX_PORT)/"; fi ;;
  pair)    pnpm -C "$INSTALL_DIR" --filter backend pair ;;
  *)
    echo "usage: trux {status|start|stop|restart|logs|update|token|url|pair}" >&2
    exit 1 ;;
esac
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash deploy/test_install.sh`
Expected: all `PASS:` lines incl. `trux shim token/url ...`, then `ALL TESTS PASSED`.

- [ ] **Step 5: Static check**

Run: `shellcheck -x bin/trux`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add bin/trux deploy/test_install.sh
git commit -m "feat: trux management shim (status/restart/logs/update/token/url/pair)"
```

---

## Task 7: `install.sh` — the curl entrypoint

**Files:**
- Create: `install.sh`

- [ ] **Step 1: Write `install.sh`**

Create `install.sh` at the repo root:

```bash
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
```

- [ ] **Step 2: Static check**

Run: `shellcheck -x install.sh`
Expected: clean.

- [ ] **Step 3: Syntax + preflight smoke (no clone)**

Run: `bash -n install.sh && echo "syntax ok"`
Expected: `syntax ok`

- [ ] **Step 4: Commit**

```bash
git add install.sh
git commit -m "feat: curl|bash installer entrypoint (preflight + clone + provision)"
```

---

## Task 8: integration run on this box (real acceptance)

**Files:** none (executes the system).

This is the end-to-end acceptance test on the actual machine. `~/.trux/.env` already exists here, so `ensure_env` will keep it (idempotent path is the one exercised).

- [ ] **Step 1: Provision from the local checkout**

Run: `bash deploy/provision.sh`
Expected: build output, `trux: ... exists — keeping it`, `tailscale serve configured`, and the install banner with local/phone URLs + token.

- [ ] **Step 2: Verify the service is active and the rendered unit is correct**

Run:
```bash
systemctl --user is-active trux.service
grep -E '^(WorkingDirectory|ExecStart)=' ~/.config/systemd/user/trux.service
```
Expected: `active`; `WorkingDirectory=` points at this checkout; `ExecStart=` uses the absolute pnpm path (no `__…__` placeholders).

- [ ] **Step 3: Verify the app responds**

Run: `curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:4317/`
Expected: `200`

- [ ] **Step 4: Verify the shim works**

Run: `~/.local/bin/trux url && ~/.local/bin/trux status --no-pager | head -3`
Expected: a URL line, then `trux.service` shown as loaded/active.

- [ ] **Step 5: Full test + typecheck regression**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all tests pass (currently 201), typecheck clean — proves the installer changes didn't break the app.

---

## Task 9: README with the one-liner

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

Create `README.md` at the repo root:

```markdown
# Trux

Drive coding agents (Claude, opencode, codex) on your dev box from your phone, over your tailnet.

## Install

On the machine where your code lives (Linux + systemd):

\`\`\`sh
curl -fsSL https://raw.githubusercontent.com/Jodulabs/trux/main/install.sh | bash
\`\`\`

This clones trux into \`~/.local/share/trux\`, builds it, writes \`~/.trux/.env\`
(generating your token), installs a systemd user service that auto-starts on boot,
and configures \`tailscale serve\`. It prints your URL and token at the end.

### Prerequisites
- **Node.js >= 22** and **pnpm** (the installer enables it via corepack if present)
- **git**
- **Tailscale** on this box and your phone, same tailnet (for remote/phone access)
- **\`claude\` CLI** installed and logged in on this box (the default agent uses it)

## Connect your phone
1. Run \`trux pair\` to print a QR code, scan it (phone on the tailnet) — trux opens already signed in.
2. Browser menu → **Add to Home Screen** to install the PWA.

## Manage
\`\`\`sh
trux status      # service status
trux logs        # follow logs
trux restart     # restart the backend
trux update      # pull latest, rebuild, restart
trux token       # print your auth token
trux url         # print your access URL
trux pair        # show the phone-pairing QR
\`\`\`

## Update
\`\`\`sh
trux update
\`\`\`

## Uninstall
\`\`\`sh
systemctl --user disable --now trux.service
rm -f ~/.config/systemd/user/trux.service ~/.local/bin/trux
rm -rf ~/.local/share/trux ~/.trux
tailscale serve --https=443 off 2>/dev/null || true
\`\`\`

## Develop
\`\`\`sh
git clone https://github.com/Jodulabs/trux.git && cd trux
pnpm install
pnpm dev      # vite + backend in watch mode
pnpm test
\`\`\`
See \`docs/RUNBOOK.md\` for the manual run/connect details.
```

- [ ] **Step 2: Verify the install URL in the README matches the real raw path**

Run: `grep -q 'raw.githubusercontent.com/Jodulabs/trux/main/install.sh' README.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with one-line install + trux command reference"
```

---

## Task 10: finish the branch

- [ ] **Step 1: Full green check**

Run: `bash deploy/test_install.sh && shellcheck -x install.sh deploy/*.sh bin/trux && pnpm -r test`
Expected: `ALL TESTS PASSED`, shellcheck clean, all app tests pass.

- [ ] **Step 2: Merge per project workflow**

Use superpowers:finishing-a-development-branch to merge `feat/installer` → `main` (merge when green), matching the established phase workflow.

---

## Self-Review

**Spec coverage** (against the chosen design — curl|sh, personal/few-machines):
- One-line install, no manual clone → Task 7 (`install.sh` clones under the hood) + Task 9 (README one-liner). ✓
- No hardcoded user path → Task 1 (template) + Task 2 (`render_service` substitutes derived `TRUX_DIR`). ✓
- pnpm not on systemd PATH → Task 1/2 inject absolute `__PNPM__` via `command -v pnpm`. ✓
- Auto-start + survive reboot → Task 4 (`enable-linger`, `enable --now`). ✓
- Idempotent re-run / update path → Task 3 (`ensure_env` keeps existing), Task 6 (`trux update`), Task 7 (pull on existing checkout). ✓
- One implementation (DRY) → Task 5 (`setup.sh` delegates to `provision.sh`). ✓
- Management UX → Task 6 (`trux` shim). ✓
- Docs → Task 9 (README incl. prerequisites + uninstall). ✓
- Doesn't break the app → Task 8 Step 5 + Task 10 (full test/typecheck). ✓

**Placeholder scan:** the only `__…__` tokens are intentional template placeholders in `trux.service.template`, asserted-substituted by `render_service` (Task 2 Step 1) and re-checked in Task 8 Step 2. No TBD/TODO/"handle edge cases" steps. ✓

**Type/name consistency:** function names (`resolve_dirs`, `render_service`, `ensure_env`, `install_shim`, `setup_tailscale`, `print_banner`, `main`) and variables (`TRUX_DIR`, `PNPM_BIN`, `ENV_FILE`, `SERVICE_DST`, `SHIM_DST`, `INSTALL_DIR`) are used consistently across Tasks 2–8. Shim subcommands in `bin/trux` (Task 6) match those documented in the README (Task 9) and the banner (Task 4). ✓
```
