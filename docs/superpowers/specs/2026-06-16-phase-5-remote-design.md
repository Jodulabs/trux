# Phase 5 — Remote access, auth hardening, PWA

*Branch: `phase-5-remote` · Companion: [roadmap](../../../docs/2026-06-16-trux-roadmap.md)*

---

## Goal

Make trux accessible from a phone over Tailscale, with proper bearer auth, PWA install, and mobile-friendly UX.

---

## Architecture: Tailscale terminates TLS

The backend stays HTTP on `127.0.0.1:4317`. Tailscale's `serve` command proxies `https://<machine>.ts.net → http://127.0.0.1:4317`, providing valid TLS without any Node certificate management. The frontend is served as static files by the backend in production (via `@fastify/static`).

```
Phone
  └─ HTTPS → Tailscale MagicDNS (<machine>.ts.net)
                └─ tailscale serve → http://127.0.0.1:4317
                                        └─ Fastify (backend + static frontend)
```

---

## 1. Auth hardening

### Startup guard

When `TRUX_AUTH=1` is set without a `TRUX_SECRET`, the backend should crash immediately rather than silently accepting all traffic. Add to `apps/backend/src/index.ts`:

```ts
export function assertConfig(config: Config): void {
  if (config.authRequired && !config.secret) {
    throw new Error('TRUX_AUTH=1 requires TRUX_SECRET to be set')
  }
}
```

Call before `buildServer`.

### Frontend token gate

The frontend reads `localStorage.getItem('trux_token')` silently. When auth is required and no token is stored, all REST calls return 401. Rather than crashing, `App.tsx` should detect this and show a token input:

```
App.tsx
  if (loadConversations() → 401) → render <TokenGate onSaved={() => retry()} />
  else → render normal layout
```

`TokenGate` is a simple `<input type="password">` + "Save" button that writes to `localStorage` and calls `onSaved()`.

No routing, no dedicated page — just a conditional render.

---

## 2. WS protocol fix

The WS URL is hardcoded as `ws://`. Over HTTPS (Tailscale), this must be `wss://`. Fix in `ConversationView.tsx`:

```ts
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
url: `${proto}//${location.host}/conversations/${id}/stream`
```

---

## 3. Backend static serving

The backend serves the Vite build output so the phone only needs one URL. Add `@fastify/static` to the backend. In `server.ts`:

```ts
await app.register(fastifyStatic, {
  root: join(dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist'),
  prefix: '/',
  decorateReply: false,
})
app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'))
```

The SPA fallback means deep navigation links work. During dev, Vite proxies to the backend — no change there.

---

## 4. Tailscale hostname config + remote preview

`TRUX_TAILSCALE_HOST` env var stores the machine's Tailscale hostname (e.g. `mybox.tail12345.ts.net`). A new `GET /config` route (no auth gate) returns `{ tailscaleHost: string | null }`.

The frontend reads this on boot. When `previewPort` is detected and `tailscaleHost` is set, "Open preview" opens `https://${tailscaleHost}:${previewPort}` instead of `http://localhost:${previewPort}`.

The user runs `tailscale serve --bg :<port> http://127.0.0.1:<port>` manually per dev-server port for now.

---

## 5. systemd user unit

`~/.config/systemd/user/trux.service`:

```ini
[Unit]
Description=Trux backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/gp/dreamLand/jodulabs/trux
EnvironmentFile=%h/.trux/.env
ExecStart=/usr/bin/env pnpm --filter backend start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable with:
```sh
loginctl enable-linger gp
systemctl --user daemon-reload
systemctl --user enable --now trux.service
```

`~/.trux/.env` (mode 0600):
```
TRUX_AUTH=1
TRUX_SECRET=<64-char hex from `openssl rand -hex 32`>
TRUX_HOST=127.0.0.1
TRUX_PORT=4317
TRUX_WORKSPACES=/home/gp/dreamLand
TRUX_TAILSCALE_HOST=<machine>.ts.net
```

One-time Tailscale serve setup:
```sh
tailscale serve --bg https / http://127.0.0.1:4317
```

---

## 6. PWA

### manifest.json (`apps/frontend/public/manifest.json`):

```json
{
  "name": "Trux",
  "short_name": "Trux",
  "description": "Self-hosted multi-agent coding chat",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#1a1a1a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### index.html additions:

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#1a1a1a" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Trux" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

Also update viewport: `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`

### Service worker (`apps/frontend/public/sw.js`):

Cache-first shell worker. Passes through all `/conversations` and `/workspaces` fetches. Registered in `main.tsx` after React render.

---

## 7. Mobile UX

Key CSS rules to add to the existing stylesheet:

- `height: 100dvh` on `.app` (accounts for mobile browser chrome)
- On `max-width: 640px`: sidebar scrolls horizontally, main fills remaining height
- `.conversation`: flex column — transcript scrolls, composer sticks to bottom
- `padding-bottom: env(safe-area-inset-bottom, 0)` on `.composer` (iPhone home bar)
- Auto-resize textarea in `Composer.tsx` via `el.style.height = scrollHeight + 'px'` capped at 160px
- `min-height: 44px` on approval buttons (WCAG 2.5.5 touch target)
- `white-space: pre-wrap; overflow-x: auto; max-height: 200px` on approval card `<pre>`

---

## Files changed

| File | Action |
|---|---|
| `apps/backend/src/index.ts` | `assertConfig` guard |
| `apps/backend/src/config.ts` | `tailscaleHost` field |
| `apps/backend/src/routes.ts` | `GET /config` route |
| `apps/backend/src/server.ts` | `@fastify/static` + SPA fallback |
| `apps/backend/package.json` | add `@fastify/static` |
| `apps/frontend/src/App.tsx` | 401 detection → token gate |
| `apps/frontend/src/components/TokenGate.tsx` | NEW |
| `apps/frontend/src/components/ConversationView.tsx` | wss fix + Tailscale preview URL |
| `apps/frontend/src/store.ts` | `tailscaleHost` state + `loadRemoteConfig` |
| `apps/frontend/src/api.ts` | `getRemoteConfig()` |
| `apps/frontend/index.html` | PWA meta + viewport-fit |
| `apps/frontend/public/manifest.json` | NEW |
| `apps/frontend/public/sw.js` | NEW |
| `apps/frontend/public/icon-192.png` | NEW (placeholder) |
| `apps/frontend/public/icon-512.png` | NEW (placeholder) |
| `apps/frontend/src/main.tsx` | SW registration |
| `apps/frontend/src/components/Composer.tsx` | auto-resize textarea |
| `apps/frontend/src/components/ApprovalCard.tsx` | (CSS only, no TSX change) |
| `apps/frontend/src/index.css` (or equivalent) | mobile layout rules |
| `deploy/trux.service` | NEW systemd unit template |
| `deploy/setup.sh` | NEW setup script |
| `docs/2026-06-16-trux-roadmap.md` | check off phase 5 items |
