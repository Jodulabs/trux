#!/usr/bin/env bash
# Trux Phase 5 setup script.
# Run once after `tailscale up` and `pnpm install`.

set -euo pipefail

TRUX_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HOME/.trux/.env"
SERVICE_SRC="$TRUX_DIR/deploy/trux.service"
SERVICE_DST="$HOME/.config/systemd/user/trux.service"

# 1. Build frontend
echo "Building frontend..."
pnpm --filter frontend build

# 2. Create env file if missing
if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$HOME/.trux"
  SECRET=$(openssl rand -hex 32)
  TS_HOST=$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Self']['DNSName'].rstrip('.'))" 2>/dev/null || echo "")
  cat > "$ENV_FILE" <<EOF
TRUX_AUTH=1
TRUX_SECRET=$SECRET
TRUX_HOST=127.0.0.1
TRUX_PORT=4317
TRUX_WORKSPACES=$HOME
TRUX_TAILSCALE_HOST=$TS_HOST
EOF
  chmod 0600 "$ENV_FILE"
  echo "Created $ENV_FILE (edit TRUX_WORKSPACES and TRUX_TAILSCALE_HOST as needed)"
  echo "Your token: $SECRET"
else
  echo "Env file $ENV_FILE already exists — skipping"
fi

# 3. Install systemd unit
mkdir -p "$(dirname "$SERVICE_DST")"
cp "$SERVICE_SRC" "$SERVICE_DST"
# Substitute %h with actual home dir in WorkingDirectory (systemd expands %h too, but be explicit)
sed -i "s|%h|$HOME|g" "$SERVICE_DST"

# 4. Enable linger + start service
loginctl enable-linger "$(whoami)"
systemctl --user daemon-reload
systemctl --user enable --now trux.service
echo "Service started. Check: systemctl --user status trux.service"

# 5. Configure Tailscale serve (idempotent)
if command -v tailscale &>/dev/null; then
  tailscale serve --bg https / http://127.0.0.1:4317 2>/dev/null || true
  echo "Tailscale serve configured. Check: tailscale serve status"
else
  echo "Tailscale not found — skip serve setup"
fi

echo ""
echo "Done! Access trux at: https://$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null || echo '<tailscale-hostname>')"
