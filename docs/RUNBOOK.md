# Trux — Run & Connect Runbook

How to start trux on your dev machine and drive it from your phone (Claude, over Tailscale).

---

## A. Local sanity check (2 min, no phone)

Proves the app and the agent loop work before involving the network.

```sh
pnpm install            # once
pnpm build              # build the web app (Expo web export → apps/mobile/dist)
TRUX_WORKSPACES=$HOME pnpm start
```

- The backend serves the built web app, so open **http://localhost:4317/** — you should see the
  trux UI (sidebar + empty state), not a JSON 404.
- New conversation → pick **claude** + a repo under `$HOME` → prompt it → watch the streaming reply,
  approve a tool, hit **Open preview** if it starts a dev server.
- The startup log prints `trux: serving frontend from …`. If it says `no frontend build at …`, run
  `pnpm build`.

---

## B. Phone over Tailscale (the real path)

**Prereqs:** Tailscale installed on **both** the dev box and the phone, joined to the same tailnet;
`claude` logged in on the box.

**One-time setup:**

```sh
bash deploy/setup.sh
```

This builds the frontend, writes `~/.trux/.env` (generates `TRUX_SECRET`, detects your tailnet host),
installs + starts the systemd user service, and runs `tailscale serve`. It prints your token and URL.

**Or run it in the foreground** (no systemd) once `~/.trux/.env` exists:

```sh
pnpm build && pnpm start
```

**Connect the phone:**

1. On start, the terminal prints a **QR code**. On your phone (on the tailnet), scan it with the
   camera → trux opens **already signed in** (the token rides the URL fragment).
2. **Install the PWA:** browser share menu → *Add to Home Screen*.
3. Drive: new conversation → **claude** + a repo → prompt → approve tools → **Open preview**.

You can also pair later from inside the app: **Sidebar → 📱 Pair phone** shows the same QR.

---

## `~/.trux/.env`

```sh
TRUX_AUTH=1
TRUX_SECRET=<openssl rand -hex 32>
TRUX_HOST=127.0.0.1
TRUX_PORT=4317
TRUX_WORKSPACES=/home/you/code        # colon-separated roots the agent may open
TRUX_TAILSCALE_HOST=yourbox.tailXXXX.ts.net
```

`pnpm start` auto-loads this file (repo-local `.env` wins per-key if present).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Phone shows JSON `404` instead of the app | Frontend not built — run `pnpm build`. Startup log confirms `serving frontend from …`. |
| Reload on a sub-page errors | Should be fixed (SPA fallback). If not, rebuild + restart. |
| Phone can't reach the URL | `tailscale serve status`; phone must be on the same tailnet. |
| Token prompt / 401 | Re-scan the QR, or paste `TRUX_SECRET` into the token gate. |
| QR not printed on start | Set `TRUX_TAILSCALE_HOST` and `TRUX_SECRET` in `~/.trux/.env`. |
