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
trux open        # launch on this box already signed in (token in URL fragment)
trux pair        # show the phone-pairing QR
```

## Update
```sh
trux update
```

## Uninstall
```sh
trux uninstall            # stop+remove service, shim, and code; keeps ~/.trux
trux uninstall --purge    # also delete ~/.trux (your token + conversation history)
```
Keeps your token and conversation history (`~/.trux`) by default. Login linger is
left enabled (it's a shared setting) — disable it with `loginctl disable-linger "$(whoami)"`.

## Develop
```sh
git clone https://github.com/Jodulabs/trux.git && cd trux
pnpm install
pnpm dev      # vite + backend in watch mode
pnpm test
```
See `docs/RUNBOOK.md` for the manual run/connect details.
