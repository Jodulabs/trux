#!/usr/bin/env bash
# Restart the trux backend WITHOUT changing its environment.
#
# Why this exists: the backend is launched with TRUX_SECRET (which is the #token
# in the user's browser URL), TRUX_WORKSPACES, TRUX_TAILSCALE_HOST, etc. A naive
# `pnpm restart` inherits whatever the current shell has — usually nothing — so
# the token rotates and every open client/URL breaks. This captures the running
# process's real env from /proc first, then relaunches with exactly that env so
# the token and workspaces stay stable.
#
# Usage: restart-backend.sh [repo_root]   (defaults to the trux repo this lives in)
set -euo pipefail

PORT="${TRUX_PORT:-4317}"
REPO="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
PNPM="$(command -v pnpm || echo /home/gp/.local/share/pi-node/node-v22.22.3-linux-x64/bin/pnpm)"
LOG="${TMPDIR:-/tmp}/trux-backend.log"

pid="$(fuser "${PORT}/tcp" 2>/dev/null | tr -d ' ' || true)"
envfile="$(mktemp)"
if [ -n "$pid" ]; then
  # Grab the live env so the restart is byte-identical to how it was started.
  tr '\0' '\n' < "/proc/${pid}/environ" | grep -E '^TRUX_' > "$envfile" || true
  echo "captured $(wc -l < "$envfile") TRUX_ vars from pid $pid"
else
  echo "no backend on :${PORT} — starting fresh (env must come from your shell or ~/.trux/.env)"
fi

fuser -k "${PORT}/tcp" 2>/dev/null || true
until ! fuser "${PORT}/tcp" >/dev/null 2>&1; do sleep 1; done

set -a; [ -s "$envfile" ] && . "$envfile"; set +a
rm -f "$envfile"

( cd "$REPO" && setsid "$PNPM" --filter @trux/backend start > "$LOG" 2>&1 < /dev/null & )

i=0; until fuser "${PORT}/tcp" >/dev/null 2>&1 || [ $i -ge 40 ]; do sleep 1; i=$((i+1)); done
if fuser "${PORT}/tcp" >/dev/null 2>&1; then
  echo "backend up on :${PORT} (pid $(fuser "${PORT}/tcp" 2>/dev/null | tr -d ' ')) — log: $LOG"
else
  echo "backend did NOT come up; check $LOG"; tail -20 "$LOG"; exit 1
fi
