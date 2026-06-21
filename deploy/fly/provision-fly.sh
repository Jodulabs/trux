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
  # shellcheck disable=SC2086  # ${repo:+…}/${gh:+…} must expand to a separate arg or vanish
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
