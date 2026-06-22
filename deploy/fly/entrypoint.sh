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
