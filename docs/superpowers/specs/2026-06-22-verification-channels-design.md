# Verification Channels — terminal + web preview — Design Spec

**Status:** design, pending implementation plan
**Date:** 2026-06-22
**Scope:** Add **verification/output channels** so a developer can *test the app from the phone, not just read code*: a **terminal** (run commands, see output) and a **web preview** (open the app the agent is running, in the phone's own browser). Both are multiplexed over trux's existing paired phone↔box connection. Scoped to **option I** — preview the app's *own* dev server; nothing runs a browser on the box. Companion to the cloud dev machine. Decision record: memory `trux-verification-channels`.

---

## Governing principles

**1. Channels on the link you already have.** trux already runs one channel — the agent conversation — over a token-gated WebSocket (`stream.ts`) behind one public URL (Fly proxy / `tailscale serve`). Terminal and preview are just **more channels on that same link**: same transport, same `tokenAccepted` boundary (`auth.ts:12`), no relay, no new ports to expose. This parallels the agent stream; it does not replace or alter it.

**2. The phone is the browser.** For "test the web app the agent built," the phone is already an excellent browser — so we **proxy the app's own dev-server port** to it rather than running and streaming a browser on the box. Nothing headless, no pixels over the wire. (Streaming a real box browser — CDP/VNC — was option II and is explicitly out.)

---

## Architecture overview

```
 phone                                   box (trux server, one public port)
  ┌───────────────┐   WS  /conversations/:id/terminal     ┌──────────────────┐
  │ xterm.js pane │◀────── auth-first, then PTY bytes ────▶│ node-pty in the   │
  └───────────────┘                                        │ conversation cwd  │
  ┌───────────────┐   HTTP+WS  /…preview/<port>/…          ├──────────────────┤
  │ phone browser │◀────── reverse proxy (token-gated) ───▶│ 127.0.0.1:<port>  │
  │  (the app)    │        incl. HMR websocket upgrade     │ (agent's dev srv) │
  └───────────────┘                                        └──────────────────┘
```

Both attach to the existing Fastify app (`server.ts:38-41` registers routes + stream; the channels register the same way). The **terminal** is a WebSocket route mirroring `stream.ts` exactly — auth as the first message, then a duplex byte stream — with the PTY spawned in the conversation's `cwd` (the same `cwd` REST git ops already resolve via `registry.getConversation(id).cwd`, `routes.ts:217`). The **preview** is an HTTP+WebSocket reverse proxy from a trux route to `127.0.0.1:<port>` on the box; on Fly, where only `:4317` is public, trux does this proxying internally on that one port — no extra exposure.

---

# Phase 1 — Terminal channel (the easy win)

A PTY on the box bridged to `xterm.js` on the phone.

- **Backend:** a `{ websocket: true }` route `/conversations/:id/terminal` registered like `stream.ts`. First message is `auth` (reuse `tokenAccepted`); on success, spawn `node-pty` (shell) in the conversation's `cwd`. Forward pty→socket (output) and socket→pty (keystrokes); handle a `resize` control message (cols/rows); kill the pty on socket close. One PTY per socket.
- **Phone:** an `xterm.js` terminal pane (native: an RN xterm equivalent / webview) with the standard mobile-UX treatment (keyboard avoidance, thumb-reachable, large tap targets — the project's mobile standard). Reconnect mirrors the conversation stream's behaviour.
- **Security:** a PTY is RCE-equivalent — but the agent already executes arbitrary commands in this `cwd`, so the terminal adds **no new privilege**, only a direct human surface; it is gated by the **same token** as everything else ("the auth boundary is the RCE boundary", `auth.ts:4`). Never expose it unauthenticated.

## Phase 1 testing
Auth-first enforced (no pty before a valid token, mirroring `stream.ts:34`); a command's output round-trips; `resize` adjusts the pty; closing the socket reaps the process; cwd is the conversation's. Mobile-viewport screenshot per the project standard.

---

# Phase 2 — Web preview (proxy the app to the phone's browser)

Open the agent's running dev server in the phone browser, HMR included, token-gated.

- **Proxy:** an HTTP reverse proxy with **WebSocket upgrade** passthrough (so HMR/live-reload works) from a trux route to `127.0.0.1:<port>`. Use a vetted proxy (e.g. `@fastify/http-proxy`, which supports `websocket: true`) or a thin manual upgrade handler.
- **Port discovery:** detect listening ports on the box and present a **"Ports" panel** (like Codespaces) listing what's up; allow an explicit declare as fallback. The agent typically starts the dev server during a turn, so discovery keys off newly-bound local ports.
- **Auth for an in-browser preview (the subtlety):** a page the phone browser opens **cannot send a `Bearer` header**, so the REST gate doesn't apply directly. Auth rides the URL instead — a tokenized/signed preview URL (or a short-lived cookie set after a token handshake). The app must never be reachable without it.
- **URL rewriting (the one real fork — see Open items):** dev servers assume they live at root `/`. Either **subdomain-per-port** (app runs at root, zero rewrite, needs wildcard TLS) or **path-prefix** (`/…preview/<port>/…`, simple routing but the dev server must set its `base`). This choice shapes only the preview half.

## Phase 2 testing
A served app loads end-to-end through the proxy in a real browser; HMR websocket connects and hot-reloads; an unauthenticated/untokenised request is rejected; the Ports panel reflects a server coming up and going down; on a Fly box the whole thing works through the single public port. Mobile-viewport screenshots.

---

## Non-goals

- **No browser on the box.** No CDP screencast, VNC/noVNC, or WebRTC streaming — that was option II, deferred. The phone renders the app itself.
- **No screenshot-on-action** verification surface (a separate, later idea).
- **No new transport.** Channels ride the existing token-gated WS/HTTP; no relay, no extra exposed ports (Fly stays single-port).
- **No public exposure.** Terminal and preview are gated by the same token as the agent stream; the previewed app is never world-reachable.
- **No change to the agent stream** (`stream.ts`) or the conversation model — channels are additive.

---

## Open items resolved at plan time

- **Preview URL rewrite strategy** — subdomain-per-port (clean, needs wildcard TLS on the box host; feasible via `sslip.io`+Caddy locally, a wildcard cert on Fly) vs path-prefix (simple, needs dev-server `base`). Lean: subdomain if wildcard TLS is cheap on the host, else path-prefix MVP with the documented limitation.
- **Preview auth mechanism** — tokenised/signed URL vs short-lived cookie set after a token handshake; pick one and make it the only way in.
- **Port discovery** — auto-detect bound ports (scan `/proc`/`ss`) + a "Ports" panel vs explicit declare; and how to surface protocol/HTTPS hints.
- **Terminal session model** — one PTY per socket (Phase 1) vs persistent/multiple named terminals that survive reconnect; default shell + env.
- **Native terminal renderer** — `xterm.js` in a webview vs an RN-native terminal component for the Expo app; confirm at plan time.
- **Fly internal proxying** — confirm `@fastify/http-proxy` upgrade passthrough behind Fly's proxy for both HTTP and WS on `:4317`.
