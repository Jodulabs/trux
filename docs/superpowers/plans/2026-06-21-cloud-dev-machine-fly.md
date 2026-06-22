# Cloud Dev Machine — Fly Driver (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand trux up on the user's own Fly.io account as an always-on (scale-to-zero) cloud dev machine the phone pairs to — so you can code on the go without your own computer being on. One command (`trux fly <app>`) builds the image, deploys it, and prints the pairing QR; Fly's wake-on-request handles lifecycle thereafter.

**Architecture:** The trux *server* is unchanged — only **how the box is born** (a Docker image + `fly.toml` + flyctl, vs. local's `provision.sh` + systemd) and **how it's reached** (Fly's built-in Anycast TLS proxy, vs. local's `tailscale serve`) differ. Local stays driver #1, untouched. We do **not** build a `ComputeDriver` abstraction yet (spec Phase 3) — Fly ships as its own concrete path. The single shared code edit is generalizing `TRUX_TAILSCALE_HOST` → `TRUX_PUBLIC_HOST` (backward-compatible) so pairing works against the `.fly.dev` host. Spec: `docs/superpowers/specs/2026-06-21-cloud-dev-machine-fly-design.md`.

**Tech Stack:** Fly.io (Machines, volumes, secrets, Anycast TLS proxy), `flyctl`, Docker (`node:22-bookworm-slim`), pnpm 11 / Node 22, the `@anthropic-ai/claude-code` CLI as the bundled agent, Bash (`set -euo pipefail`) + shellcheck, vitest for the backend TS change, a sandboxed bash harness (`deploy/fly/test_fly.sh`) mirroring the existing `deploy/test_install.sh`.

**Testing discipline:** TS changes follow TDD on vitest. Shell follows the project's installer convention — every shell file passes `shellcheck -x`, and side-effect-contained functions are exercised by a sandboxed harness against a throwaway `$HOME`/`mktemp -d` with stubbed `git`/`fly`/`pnpm` on `PATH`. Image + Fly deploy are verified by two integration acceptance tasks (local Docker run needs no Fly account; the Fly deploy needs the engineer's own Fly account + keys).

**Branch:** `feat/cloud-dev-machine-fly` (feature branch per phase, merge to `main` when green — project workflow).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/backend/src/config.ts` | modify | Add optional `publicHost` = `TRUX_PUBLIC_HOST ?? TRUX_TAILSCALE_HOST ?? null`. |
| `apps/backend/src/banner.ts` | modify | Start/pair banners + QR use `publicHost ?? tailscaleHost`; drop the tailnet-only wording. |
| `apps/backend/test/config.test.ts` | modify | Tests for `publicHost` precedence/fallback; keep the defaults `toEqual` honest. |
| `bin/trux` | modify | `url` honors `TRUX_PUBLIC_HOST`; new `fly` subcommand delegating to the Fly provisioner. |
| `deploy/test_install.sh` | modify | Extend the shim test to assert `TRUX_PUBLIC_HOST` precedence. |
| `Dockerfile` | create (repo root) | Bake Node 22 + pnpm + trux + built frontend + `claude` CLI; entrypoint = the Fly boot script. |
| `.dockerignore` | create (repo root) | Exclude `node_modules`/`.git`/`apps/mobile`/build output from the build context. |
| `deploy/fly/entrypoint.sh` | create | Idempotent machine boot: clone the user's repo onto `/data`, point trux at the volume, exec the server bound to `0.0.0.0`. |
| `deploy/fly/fly.toml` | create | `http_service` scale-to-zero + wake-on-request + `force_https`; `/data` volume mount. |
| `deploy/fly/provision-fly.sh` | create | `trux fly <app>`: flyctl create app + volume + secrets + deploy, then print the pairing QR. |
| `deploy/fly/test_fly.sh` | create | Sandboxed tests for `entrypoint.sh` and `provision-fly.sh` (stubbed `git`/`fly`/`pnpm`). |
| `README.md` | modify | "Run in the cloud (Fly.io)" section. |

---

## Task 1: Generalize the pairing host — `TRUX_PUBLIC_HOST` (backend)

**Files:**
- Modify: `apps/backend/src/config.ts`
- Modify: `apps/backend/src/banner.ts`
- Test: `apps/backend/test/config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/backend/test/config.test.ts`, add `'TRUX_PUBLIC_HOST'` to the `KEYS` array on line 4 (so test isolation clears it):

```ts
const KEYS = ['TRUX_HOST', 'TRUX_PORT', 'TRUX_DB_PATH', 'TRUX_SECRET', 'TRUX_AUTH', 'TRUX_WORKSPACES', 'TRUX_TAILSCALE_HOST', 'TRUX_PUBLIC_HOST', 'TRUX_PUSH_PRIVACY']
```

In the `'reads overrides from the environment'` test, add `publicHost: null,` to the `toEqual` object (right after `tailscaleHost: null,`) so the full-object match stays accurate:

```ts
      workspaceRoots: ['/a', '/b'],
      tailscaleHost: null,
      publicHost: null,
      pushPrivacy: false,
    })
```

Then add these three tests inside the `describe('loadConfig', …)` block, after the existing `'reads TRUX_TAILSCALE_HOST'` test:

```ts
  it('reads TRUX_PUBLIC_HOST', () => {
    process.env.TRUX_PUBLIC_HOST = 'myapp.fly.dev'
    expect(loadConfig().publicHost).toBe('myapp.fly.dev')
  })

  it('falls back to TRUX_TAILSCALE_HOST when TRUX_PUBLIC_HOST is unset', () => {
    process.env.TRUX_TAILSCALE_HOST = 'mybox.ts.net'
    expect(loadConfig().publicHost).toBe('mybox.ts.net')
  })

  it('prefers TRUX_PUBLIC_HOST over TRUX_TAILSCALE_HOST', () => {
    process.env.TRUX_PUBLIC_HOST = 'myapp.fly.dev'
    process.env.TRUX_TAILSCALE_HOST = 'mybox.ts.net'
    expect(loadConfig().publicHost).toBe('myapp.fly.dev')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @trux/backend exec vitest run config.test.ts`
Expected: FAIL — `publicHost` is `undefined` (property doesn't exist yet) and the `toEqual` object now expects a `publicHost` key the result lacks.

- [ ] **Step 3: Implement `publicHost` in config**

In `apps/backend/src/config.ts`, add the field to the `Config` interface immediately after `tailscaleHost: string | null`:

```ts
  tailscaleHost: string | null
  // Public hostname the phone reaches trux at, for pairing URLs/QR. Backend-agnostic:
  // local sets it from Tailscale, the Fly driver sets it to <app>.fly.dev. Optional so
  // existing Config literals (tests, server) keep compiling.
  publicHost?: string | null
```

In `loadConfig`, add this line right after the `tailscaleHost:` line:

```ts
    tailscaleHost: env.TRUX_TAILSCALE_HOST ?? null,
    publicHost: env.TRUX_PUBLIC_HOST ?? env.TRUX_TAILSCALE_HOST ?? null,
```

- [ ] **Step 4: Make the banners use `publicHost`**

In `apps/backend/src/banner.ts`, in `printStartBanner`, replace the opening of the function so it resolves a host once:

```ts
export function printStartBanner(config: Config): void {
  const host = config.publicHost ?? config.tailscaleHost
  console.log(`\n   local:  http://localhost:${config.port}/`)
  if (host) {
    console.log(`   phone:  https://${host}/`)
    if (config.secret) console.log('   pair:   run `pnpm pair` to show the QR for one-scan phone setup')
    else console.log('   (auth disabled)')
  }
```

In `printAccessBanner`, replace the body that references `config.tailscaleHost`:

```ts
export function printAccessBanner(config: Config): void {
  const host = config.publicHost ?? config.tailscaleHost
  if (host) {
    const base = `https://${host}/`
    if (config.secret) {
      console.log('\n📱 Pair your phone — scan this:\n')
      qrcode.generate(`${base}#token=${encodeURIComponent(config.secret)}`, { small: true })
      console.log(`\n   …or open ${base} and paste your token`)
    } else {
      console.log(`\n📱 Phone: open ${base} (auth disabled)`)
    }
  }
  console.log(`\n   local: http://localhost:${config.port}/\n`)
}
```

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `pnpm --filter @trux/backend exec vitest run config.test.ts && pnpm --filter @trux/backend typecheck`
Expected: all config tests PASS; typecheck clean (the optional field keeps `routes.test.ts` and the `assertConfig` literals compiling unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/config.ts apps/backend/src/banner.ts apps/backend/test/config.test.ts
git commit -m "feat(backend): generalize pairing host to TRUX_PUBLIC_HOST (Tailscale fallback)"
```

---

## Task 2: `bin/trux` — `url` honors `TRUX_PUBLIC_HOST`

**Files:**
- Modify: `bin/trux`
- Modify: `deploy/test_install.sh`

- [ ] **Step 1: Extend the shim test**

In `deploy/test_install.sh`, inside `test_shim_url_token`, insert this block immediately after the existing tailnet-host assertion (the line `[ "$out" = "https://box.tail1234.ts.net/" ] || fail "trux url returned '$out'"`):

```bash
  # TRUX_PUBLIC_HOST takes precedence over the tailnet host (Fly driver).
  echo 'TRUX_PUBLIC_HOST=myapp.fly.dev' >> "$sandbox/.trux/.env"
  out="$(HOME="$sandbox" bash "$REPO/bin/trux" url)"
  [ "$out" = "https://myapp.fly.dev/" ] || fail "trux url should prefer TRUX_PUBLIC_HOST, got '$out'"
  sed -i '/TRUX_PUBLIC_HOST/d' "$sandbox/.trux/.env"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/test_install.sh`
Expected: FAIL — `trux url should prefer TRUX_PUBLIC_HOST, got 'https://box.tail1234.ts.net/'` (the shim still only reads `TRUX_TAILSCALE_HOST`).

- [ ] **Step 3: Update the `url` case in `bin/trux`**

In `bin/trux`, replace the `url)` case (lines 39–41):

```bash
    url)
      host="$(envval TRUX_TAILSCALE_HOST)"
      if [[ -n "$host" ]]; then echo "https://$host/"; else echo "http://localhost:$(envval TRUX_PORT)/"; fi ;;
```

with:

```bash
    url)
      host="$(envval TRUX_PUBLIC_HOST)"
      [[ -z "$host" ]] && host="$(envval TRUX_TAILSCALE_HOST)"
      if [[ -n "$host" ]]; then echo "https://$host/"; else echo "http://localhost:$(envval TRUX_PORT)/"; fi ;;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash deploy/test_install.sh`
Expected: `PASS: trux shim token/url read from env correctly`, then `ALL TESTS PASSED`.

- [ ] **Step 5: Static check**

Run: `shellcheck -x bin/trux deploy/test_install.sh`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add bin/trux deploy/test_install.sh
git commit -m "feat: trux url prefers TRUX_PUBLIC_HOST, falls back to tailnet host"
```

---

## Task 3: Fly machine entrypoint + sandbox tests

**Files:**
- Create: `deploy/fly/entrypoint.sh`
- Create: `deploy/fly/test_fly.sh`

- [ ] **Step 1: Write the failing tests**

Create `deploy/fly/test_fly.sh`:

```bash
#!/usr/bin/env bash
# Sandboxed tests for the Fly driver. Each test runs against a throwaway dir with
# stubbed git/fly/pnpm on PATH — no real Fly account or Docker needed.
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
echo "$2" > "$3.url" 2>/dev/null || true
mkdir -p "$3/.git"
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/fly/test_fly.sh`
Expected: FAIL — `deploy/fly/entrypoint.sh` does not exist (source error / "No such file").

- [ ] **Step 3: Write `deploy/fly/entrypoint.sh`**

Create `deploy/fly/entrypoint.sh`:

```bash
#!/usr/bin/env bash
# Trux Fly machine entrypoint. Runs on every (re)start — Fly's auto-start wakes
# call this too, so it MUST be idempotent. Ensures the user's repo is on the /data
# volume, points trux at the volume, then execs the server bound to 0.0.0.0 so
# Fly's proxy can reach it. Sourceable: main only runs when executed directly.
set -euo pipefail

# Point trux at the volume so the workspace + sqlite db survive stop/start, and
# default auth ON (this box is publicly reachable). Fly secrets supply TRUX_SECRET.
materialize_env() {
  local data_dir="${TRUX_DATA_DIR:-/data}"
  export TRUX_HOST="${TRUX_HOST:-0.0.0.0}"
  export TRUX_PORT="${TRUX_PORT:-4317}"
  export TRUX_AUTH="${TRUX_AUTH:-1}"
  export TRUX_WORKSPACES="${TRUX_WORKSPACES:-$data_dir}"
  export TRUX_DB_PATH="${TRUX_DB_PATH:-$data_dir/.trux/trux.db}"
  mkdir -p "$(dirname "$TRUX_DB_PATH")"
}

# Clone the user's project repo into the volume on first boot; a re-run with the
# repo already present is a no-op. GITHUB_TOKEN (a Fly secret) authorizes private
# clones; without it, public repos still work.
ensure_repo() {
  [[ -z "${TRUX_REPO_URL:-}" ]] && { echo "trux-fly: no TRUX_REPO_URL — starting with an empty workspace"; return 0; }
  local data_dir name dest url
  data_dir="${TRUX_DATA_DIR:-/data}"
  name="$(basename "${TRUX_REPO_URL%.git}")"
  dest="$data_dir/$name"
  if [[ -d "$dest/.git" ]]; then
    echo "trux-fly: repo $name already on the volume — keeping it"
    return 0
  fi
  url="$TRUX_REPO_URL"
  if [[ -n "${GITHUB_TOKEN:-}" && "$url" == https://github.com/* ]]; then
    url="https://x-access-token:${GITHUB_TOKEN}@${url#https://}"
  fi
  echo "trux-fly: cloning $name into $dest"
  git clone "$url" "$dest"
}

main() {
  local app_dir="${TRUX_APP_DIR:-/app}"
  materialize_env
  ensure_repo
  echo "trux-fly: starting server on $TRUX_HOST:$TRUX_PORT (workspace $TRUX_WORKSPACES)"
  exec pnpm -C "$app_dir" --filter @trux/backend start
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
```

- [ ] **Step 4: Make it executable + run the tests**

Run: `chmod +x deploy/fly/entrypoint.sh deploy/fly/test_fly.sh && bash deploy/fly/test_fly.sh`
Expected: three `PASS:` lines, then `ALL FLY TESTS PASSED`.

- [ ] **Step 5: Static check**

Run: `shellcheck -x deploy/fly/entrypoint.sh deploy/fly/test_fly.sh`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add deploy/fly/entrypoint.sh deploy/fly/test_fly.sh
git commit -m "feat(fly): idempotent machine entrypoint (clone repo to volume, bind 0.0.0.0)"
```

---

## Task 4: The trux Docker image

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore` (repo root)

- [ ] **Step 1: Write `.dockerignore`**

Create `.dockerignore` at the repo root (keeps the build context small and avoids copying host `node_modules`):

```
node_modules
**/node_modules
.git
apps/mobile
site
docs
dist
**/dist
.trux
*.db
.memsearch
```

- [ ] **Step 2: Write `Dockerfile`**

Create `Dockerfile` at the repo root:

```dockerfile
# Trux cloud dev machine image (Fly driver). Bakes the trux app + a built frontend
# + the claude CLI; the user's own code repo is cloned to /data at boot by the
# entrypoint. See docs/superpowers/specs/2026-06-21-cloud-dev-machine-fly-design.md.
FROM node:22-bookworm-slim

# git: clone the user's repo at boot. ca-certificates/openssl: TLS to GitHub + Anthropic.
# python3/make/g++: native build of better-sqlite3. claude CLI: the default agent.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates openssl python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @trux/frontend build

# Cloud defaults; secrets (TRUX_SECRET, ANTHROPIC_API_KEY, …) come from Fly at runtime.
ENV TRUX_HOST=0.0.0.0 \
    TRUX_PORT=4317 \
    TRUX_WORKSPACES=/data \
    TRUX_DB_PATH=/data/.trux/trux.db

EXPOSE 4317
ENTRYPOINT ["/app/deploy/fly/entrypoint.sh"]
```

- [ ] **Step 3: Structural assertions (cheap; the real build is Task 7)**

Run:
```bash
grep -q 'ENTRYPOINT \["/app/deploy/fly/entrypoint.sh"\]' Dockerfile && echo "entrypoint ok"
grep -q 'pnpm --filter @trux/frontend build' Dockerfile && echo "frontend build ok"
grep -qx 'apps/mobile' .dockerignore && grep -qx 'node_modules' .dockerignore && echo "dockerignore ok"
```
Expected: `entrypoint ok`, `frontend build ok`, `dockerignore ok`.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(fly): Docker image (node22 + pnpm + trux + claude CLI, volume-backed)"
```

---

## Task 5: `fly.toml` — scale-to-zero, wake-on-request, volume

**Files:**
- Create: `deploy/fly/fly.toml`

- [ ] **Step 1: Write `deploy/fly/fly.toml`**

Create `deploy/fly/fly.toml`. `app` and the Dockerfile/context are supplied at deploy time by `provision-fly.sh` (`fly deploy -a <app> --dockerfile Dockerfile .`), so they are intentionally absent here:

```toml
# Trux on Fly.io — a cloud dev machine the phone pairs to.
# Deployed by deploy/fly/provision-fly.sh. The app name + build context are passed
# on the command line so this file is reusable across users.
primary_region = "iad"

[env]
  TRUX_PORT = "4317"

# Fly's proxy terminates TLS at https://<app>.fly.dev and forwards to internal_port.
# Scale-to-zero + auto-start: the machine stops when idle and the proxy boots it on
# the next request — this is what lets the phone reach it without your computer on.
[http_service]
  internal_port = 4317
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "1gb"

# Persist the workspace + sqlite db across stop/start.
[mounts]
  source = "data"
  destination = "/data"
```

- [ ] **Step 2: Structural assertions**

Run:
```bash
grep -q 'internal_port = 4317' deploy/fly/fly.toml && echo "port ok"
grep -q 'min_machines_running = 0' deploy/fly/fly.toml && grep -q 'auto_start_machines = true' deploy/fly/fly.toml && echo "scale-to-zero ok"
grep -q 'destination = "/data"' deploy/fly/fly.toml && echo "mount ok"
```
Expected: `port ok`, `scale-to-zero ok`, `mount ok`.

- [ ] **Step 3: Optional flyctl validation (skip if flyctl absent)**

Run: `command -v fly >/dev/null && fly config validate -c deploy/fly/fly.toml || echo "flyctl not installed — validated structurally in Step 2"`
Expected: `Configuration is valid` (if flyctl present) or the skip message.

- [ ] **Step 4: Commit**

```bash
git add deploy/fly/fly.toml
git commit -m "feat(fly): fly.toml with scale-to-zero, wake-on-request, /data volume"
```

---

## Task 6: `trux fly` provisioner + `bin/trux fly` subcommand

**Files:**
- Create: `deploy/fly/provision-fly.sh`
- Modify: `bin/trux`
- Modify: `deploy/fly/test_fly.sh`

- [ ] **Step 1: Add failing tests for the provisioner**

In `deploy/fly/test_fly.sh`, add these two functions and call them before the final `echo`:

```bash
test_app_url() {
  # shellcheck disable=SC1090
  source "$REPO/deploy/fly/provision-fly.sh"
  [ "$(app_url trux-demo)" = "https://trux-demo.fly.dev" ] || fail "app_url wrong: $(app_url trux-demo)"
  pass "app_url builds the fly hostname"
}

test_provision_flow_stubbed() {
  local sandbox stub log; sandbox="$(mktemp -d)"; stub="$sandbox/bin"; log="$sandbox/calls.log"; mkdir -p "$stub"
  # Stub fly: record every call; pretend no app/volume exists yet so create runs.
  cat > "$stub/fly" <<FLY
#!/usr/bin/env bash
echo "fly \$*" >> "$log"
exit 0
FLY
  # Stub pnpm: record the pairing invocation + that it saw the fly host + a token.
  cat > "$stub/pnpm" <<PNPM
#!/usr/bin/env bash
echo "pnpm \$* HOST=\${TRUX_PUBLIC_HOST:-} TOKEN=\${TRUX_SECRET:+set}" >> "$log"
PNPM
  chmod +x "$stub/fly" "$stub/pnpm"
  if ! (
    export PATH="$stub:$PATH" ANTHROPIC_API_KEY="sk-test" TRUX_REPO_URL="https://github.com/me/app.git"
    bash "$REPO/deploy/fly/provision-fly.sh" trux-demo >/dev/null
  ); then rm -rf "$sandbox"; fail "provision-fly.sh errored"; fi
  grep -q "fly apps create trux-demo" "$log" || fail "app not created"
  grep -q "fly volumes create data --size .* -r .* -a trux-demo" "$log" || fail "volume not created"
  grep -q "fly secrets set -a trux-demo --stage" "$log" || fail "secrets not staged"
  grep -q "fly deploy --config deploy/fly/fly.toml --dockerfile Dockerfile -a trux-demo ." "$log" || fail "deploy not invoked"
  grep -q "pnpm .* --filter @trux/backend pair HOST=trux-demo.fly.dev TOKEN=set" "$log" || fail "pairing QR not invoked with fly host + token"
  rm -rf "$sandbox"
  pass "provision-fly.sh creates app/volume, stages secrets, deploys, prints QR"
}
```

Add `test_app_url` and `test_provision_flow_stubbed` on the lines above `echo "ALL FLY TESTS PASSED"`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/fly/test_fly.sh`
Expected: FAIL — `deploy/fly/provision-fly.sh` does not exist (source/exec error).

- [ ] **Step 3: Write `deploy/fly/provision-fly.sh`**

Create `deploy/fly/provision-fly.sh`:

```bash
#!/usr/bin/env bash
# `trux fly <app>` — stand up trux on the user's OWN Fly.io account (BYO cloud)
# and print the phone-pairing QR. One-time bootstrap; afterwards Fly auto-starts
# the machine on the next request, so the phone never needs your computer on.
# Sourceable: main only runs when executed directly.
# Spec: docs/superpowers/specs/2026-06-21-cloud-dev-machine-fly-design.md
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FLY="${FLY_BIN:-fly}"
REGION="${TRUX_FLY_REGION:-iad}"
VOLUME_SIZE="${TRUX_FLY_VOLUME_GB:-10}"

die() { echo "trux fly: $*" >&2; exit 1; }

# Public https URL for the deployed app — split out so it is unit-testable.
app_url() { echo "https://$1.fly.dev"; }

preflight() {
  command -v "$FLY" &>/dev/null || die "flyctl not found — install from https://fly.io/docs/flyctl/install/ then run 'fly auth login'"
  "$FLY" auth whoami &>/dev/null || die "not logged in — run 'fly auth login' first"
}

main() {
  local app="${1:-}"
  [[ -n "$app" ]] || die "usage: trux fly <app-name>   (globally unique, e.g. trux-yourname)"
  preflight

  local repo="${TRUX_REPO_URL:-}" gh="${GITHUB_TOKEN:-}" anthropic="${ANTHROPIC_API_KEY:-}"
  [[ -n "$anthropic" ]] || die "set ANTHROPIC_API_KEY (your Claude key) before running"
  [[ -n "$repo" ]] || echo "trux fly: no TRUX_REPO_URL set — the box starts with an empty workspace"

  # 1. App + volume (idempotent: only create when absent).
  "$FLY" apps list 2>/dev/null | grep -qw "$app" || "$FLY" apps create "$app"
  "$FLY" volumes list -a "$app" 2>/dev/null | grep -qw data \
    || "$FLY" volumes create data --size "$VOLUME_SIZE" -r "$REGION" -a "$app" --yes

  # 2. Secrets — token, model key, repo access; auth ON for the public box. --stage
  #    defers the restart so the following deploy picks them up in one go.
  local secret; secret="$(openssl rand -hex 32)"
  "$FLY" secrets set -a "$app" --stage \
    TRUX_AUTH=1 \
    TRUX_SECRET="$secret" \
    TRUX_PUBLIC_HOST="$app.fly.dev" \
    ANTHROPIC_API_KEY="$anthropic" \
    ${repo:+TRUX_REPO_URL="$repo"} \
    ${gh:+GITHUB_TOKEN="$gh"}

  # 3. Deploy the image (build context = repo root).
  ( cd "$REPO_DIR" && "$FLY" deploy --config deploy/fly/fly.toml --dockerfile Dockerfile -a "$app" . )

  # 4. Pairing QR — reuse the backend banner, pointed at the Fly host. dotenv does
  #    not override already-set vars, so the QR encodes the Fly URL + this token.
  echo ""
  echo "trux fly: deployed → $(app_url "$app")"
  TRUX_PUBLIC_HOST="$app.fly.dev" TRUX_SECRET="$secret" pnpm -C "$REPO_DIR" --filter @trux/backend pair
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
```

- [ ] **Step 4: Add the `fly` subcommand to `bin/trux`**

In `bin/trux`, add this case immediately after the `pair)` case (line 57):

```bash
    pair)    pnpm -C "$install_dir" --filter backend pair ;;
    fly)     exec bash "$install_dir/deploy/fly/provision-fly.sh" "${@:2}" ;;
```

And update the usage line (line 60) to advertise it:

```bash
      echo "usage: trux {status|start|stop|restart|logs|update|token|url|open|pair|fly <app>|uninstall [--purge]}" >&2
```

- [ ] **Step 5: Make executable + run the tests**

Run: `chmod +x deploy/fly/provision-fly.sh && bash deploy/fly/test_fly.sh`
Expected: all `PASS:` lines incl. `app_url …` and `provision-fly.sh creates app/volume …`, then `ALL FLY TESTS PASSED`.

- [ ] **Step 6: Static check**

Run: `shellcheck -x deploy/fly/provision-fly.sh bin/trux`
Expected: clean. (If shellcheck flags SC2086 on the `${repo:+…}`/`${gh:+…}` word-splitting, that splitting is intentional — the tokens must expand to separate `KEY=VALUE` args or vanish; add `# shellcheck disable=SC2086` on that `fly secrets set` line.)

- [ ] **Step 7: Commit**

```bash
git add deploy/fly/provision-fly.sh deploy/fly/test_fly.sh bin/trux
git commit -m "feat(fly): trux fly provisioner (app+volume+secrets+deploy+QR) and shim subcommand"
```

---

## Task 7: Local Docker build + run acceptance (no Fly account)

**Files:** none (builds and runs the image locally).

Proves the image builds, the entrypoint runs, the server binds `0.0.0.0`, and `/config` answers — all without a Fly account. Requires Docker.

- [ ] **Step 1: Build the image**

Run: `docker build -t trux-fly-test .`
Expected: build succeeds through `pnpm --filter @trux/frontend build` (frontend `dist` produced inside the image).

- [ ] **Step 2: Run it with a volume + auth, like Fly will**

Run:
```bash
docker volume create trux-test-data
docker run --rm -d --name trux-fly -p 4317:4317 \
  -e TRUX_AUTH=1 -e TRUX_SECRET=testsecret -e TRUX_HOST=0.0.0.0 \
  -v trux-test-data:/data trux-fly-test
sleep 6
```
Expected: container starts; `docker logs trux-fly` shows `trux-fly: starting server on 0.0.0.0:4317 (workspace /data)`.

- [ ] **Step 3: Verify the server answers**

Run: `curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:4317/config`
Expected: `200` (the pre-auth config endpoint serves over the bound `0.0.0.0`).

- [ ] **Step 4: Verify the volume persisted the db dir**

Run: `docker exec trux-fly ls -la /data/.trux`
Expected: the `/data/.trux` directory exists (created by `materialize_env`).

- [ ] **Step 5: Tear down**

Run: `docker rm -f trux-fly && docker volume rm trux-test-data`
Expected: container + volume removed. (No commit — this task changes no files.)

---

## Task 8: Fly deploy acceptance (real, requires a Fly account)

**Files:** none. This is the real-world acceptance gate. It needs the engineer's **own** Fly account (with billing enabled), `flyctl` logged in, a Claude API key, and optionally a GitHub repo + token. Use a throwaway unique app name.

- [ ] **Step 1: Provision**

Run:
```bash
export ANTHROPIC_API_KEY=sk-ant-...           # your Claude key
export TRUX_REPO_URL=https://github.com/you/yourrepo.git   # optional
export GITHUB_TOKEN=ghp_...                    # only if the repo is private
./deploy/fly/provision-fly.sh trux-<unique>
```
Expected: app + `data` volume created, secrets staged, image deployed, and a pairing QR printed for `https://trux-<unique>.fly.dev`.

- [ ] **Step 2: Reach it over TLS**

Run: `curl -fsS -o /dev/null -w '%{http_code}\n' https://trux-<unique>.fly.dev/config`
Expected: `200` over HTTPS (Fly's proxy, no Tailscale).

- [ ] **Step 3: Pair the phone + run a turn**

Scan the printed QR on the phone (or open the URL and paste the token). Send a message that invokes the agent (e.g. "list the files in this repo").
Expected: the conversation connects and the agent responds — confirms `claude` CLI + `ANTHROPIC_API_KEY` work headless. *If the agent fails to authenticate, see the open item on the model credential.*

- [ ] **Step 4: Verify scale-to-zero + wake-on-request**

Run:
```bash
fly machine list -a trux-<unique>
# wait for the idle auto-stop window, then:
fly machine list -a trux-<unique>        # state: stopped
curl -fsS -o /dev/null -w '%{http_code}\n' https://trux-<unique>.fly.dev/config   # wakes it
```
Expected: machine reaches `stopped` when idle; the request auto-starts it and returns `200` (after a short cold-start).

- [ ] **Step 5: Verify volume persistence**

Have the agent create a file in the workspace, then:
```bash
fly machine list -a trux-<unique>        # note the machine id
fly machine stop <id> -a trux-<unique>
fly machine start <id> -a trux-<unique>
```
Reconnect from the phone and confirm the file is still there.
Expected: the file survives stop/start (it's on `/data`).

- [ ] **Step 6: (Optional) clean up the test app**

Run: `fly apps destroy trux-<unique>`
Expected: app + volume removed.

---

## Task 9: Document the cloud path

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Run in the cloud (Fly.io)" section**

In `README.md`, insert this section immediately after the existing `## Manage` (or `## Update`) section:

````markdown
## Run in the cloud (Fly.io)

Don't want to leave your computer on? Stand trux up on **your own** Fly.io account — an
always-on box that sleeps when idle and wakes the instant your phone reconnects. Your Fly
account, your credit, your keys; trux runs no server in between.

**Prerequisites**
- A [Fly.io](https://fly.io) account with billing enabled, and [`flyctl`](https://fly.io/docs/flyctl/install/) installed + `fly auth login`
- Your Claude key in `ANTHROPIC_API_KEY`
- (Optional) the repo to work on in `TRUX_REPO_URL`, plus `GITHUB_TOKEN` if it's private

**Stand it up** (one time):

```sh
export ANTHROPIC_API_KEY=sk-ant-...
export TRUX_REPO_URL=https://github.com/you/yourrepo.git   # optional
export GITHUB_TOKEN=ghp_...                                # only if private
trux fly trux-yourname                                     # a globally-unique app name
```

This creates the app + a persistent `/data` volume, stores your secrets on Fly, deploys the
image, and prints a **pairing QR**. Scan it on your phone — same flow as a local box, but the
URL is `https://trux-yourname.fly.dev`.

**Cost:** the machine scales to zero when idle (`min_machines_running = 0`) and Fly's proxy
auto-starts it on the next request, so you mostly pay for the small volume. Manage it with
`fly machine list -a trux-yourname`, `fly logs -a trux-yourname`, `fly apps destroy trux-yourname`.
````

- [ ] **Step 2: Verify the section landed**

Run: `grep -q 'Run in the cloud (Fly.io)' README.md && grep -q 'trux fly trux-yourname' README.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the Fly.io cloud dev machine path"
```

---

## Task 10: Finish the branch

- [ ] **Step 1: Full green check**

Run:
```bash
bash deploy/test_install.sh \
  && bash deploy/fly/test_fly.sh \
  && shellcheck -x install.sh deploy/*.sh deploy/fly/*.sh bin/trux \
  && pnpm -r test \
  && pnpm -r typecheck
```
Expected: `ALL TESTS PASSED`, `ALL FLY TESTS PASSED`, shellcheck clean, all package tests pass, typecheck clean.

- [ ] **Step 2: Merge per project workflow**

Use superpowers:finishing-a-development-branch to merge `feat/cloud-dev-machine-fly` → `main` (merge when green), matching the established phase workflow.

---

## Self-Review

**Spec coverage** (against `2026-06-21-cloud-dev-machine-fly-design.md`, Phase 1):
- Governing seam "server identical; birth + reachability differ" → Tasks 3–6 add Fly birth (image/entrypoint/fly.toml/provisioner); local path untouched. ✓
- Shared edit `TRUX_TAILSCALE_HOST` → `TRUX_PUBLIC_HOST`, backward-compatible → Task 1 (config + banner, optional field keeps fixtures compiling) + Task 2 (`bin/trux url`). ✓
- 1.1 Docker image (node 22 + pnpm + built frontend + `claude` CLI, server bound 0.0.0.0) → Task 4. ✓
- 1.2 fly.toml reachability + scale-to-zero/wake + `/data` volume → Task 5. ✓
- 1.3 First-boot entrypoint: clone repo to volume, materialize env, idempotent → Task 3. ✓
- 1.4 `trux fly` provisioning path (create app/volume/secrets/deploy + print QR) → Task 6. ✓
- 1.5 testing (image answers /config; reachability+TLS; lifecycle; pairing; local untouched) → Task 3/6 sandbox + Task 7 local Docker + Task 8 Fly deploy; "local untouched" guarded by Task 10 full suite. ✓
- Out of scope per spec: Phase 2 (phone-side Fly control) and Phase 3 (`ComputeDriver` extraction) — not in this plan, by design. ✓

**Placeholder scan:** no TBD/TODO/"handle edge cases". `${repo:+…}`/`${gh:+…}` are intentional conditional-arg expansions (Task 6 Step 6 notes the shellcheck disable). The README block escapes inner fences. ✓

**Type/name consistency:** `publicHost` (config.ts interface + loadConfig + banner reads) matches across Task 1; `TRUX_PUBLIC_HOST` is identical in config.ts, `bin/trux`, `provision-fly.sh`, and `fly.toml` secrets. Entrypoint env names (`TRUX_DATA_DIR`, `TRUX_APP_DIR`, `TRUX_REPO_URL`, `GITHUB_TOKEN`, `TRUX_DB_PATH`, `TRUX_WORKSPACES`) match between `entrypoint.sh` and its tests. `provision-fly.sh` `app_url`/secret names match the test assertions and the `fly deploy` line checked in Task 6. The `fly` shim subcommand path (`deploy/fly/provision-fly.sh`) matches the file created in Task 6. ✓
```
