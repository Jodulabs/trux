# Trux

Drive coding agents (Claude, opencode, codex) on your dev box from your phone, over your tailnet.

## Install

On the machine where your code lives (Linux + systemd):

```sh
curl -fsSL https://raw.githubusercontent.com/Jodulabs/trux/main/install.sh | bash
```

This clones trux into `~/.local/share/trux`, builds it, writes `~/.trux/.env`
(generating your token), installs a systemd user service that auto-starts on boot,
and configures `tailscale serve`. It prints your URL and token at the end.

### Prerequisites
- **Node.js >= 22** and **pnpm** (the installer enables it via corepack if present)
- **git**
- **Tailscale** on this box and your phone, same tailnet (for remote/phone access)
- **`claude` CLI** installed and logged in on this box (the default agent uses it)

## Connect your phone
1. Run `trux pair` to print a QR code, scan it (phone on the tailnet) — trux opens already signed in.
2. Browser menu → **Add to Home Screen** to install the PWA.

## Manage
```sh
trux status      # service status
trux logs        # follow logs
trux restart     # restart the backend
trux update      # pull latest, rebuild, restart
trux token       # print your auth token
trux url         # print your access URL
trux pair        # show the phone-pairing QR
```

## Update
```sh
trux update
```

## Uninstall
```sh
systemctl --user disable --now trux.service
rm -f ~/.config/systemd/user/trux.service ~/.local/bin/trux
rm -rf ~/.local/share/trux ~/.trux
tailscale serve --https=443 off 2>/dev/null || true
```

## Develop
```sh
git clone https://github.com/Jodulabs/trux.git && cd trux
pnpm install
pnpm dev      # vite + backend in watch mode
pnpm test
```
See `docs/RUNBOOK.md` for the manual run/connect details.
