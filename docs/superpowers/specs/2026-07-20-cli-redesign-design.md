# Trux CLI redesign — Design Spec

**Status:** implemented
**Date:** 2026-07-20
**Approach:** Hybrid (bash lifecycle + Node access CLI)

## Goals

- Coherent day-to-day CLI: desk = `open`, phone = `pair`, box = `resume`, service = `status`/`start`/…
- Pair QR ~half today’s height, always with a pasteable link
- Reliable web launch via `trux open` (ensure up, health, signed-in browser)
- Fix stale pnpm filters and dotenv noise; no backward-compat constraint
- Do not invent new auth semantics beyond a short-lived pair redirect

## Architecture

**Bash owns:** `status` (default), `start`, `stop`, `restart`, `logs`, `update`, `uninstall`, `fly`, top-level help.

**Node owns:** `open`, `pair`, `url`, `token`, `resume` — one entry `apps/backend/src/cli.ts` dispatched from `bin/trux`.

## Command surface

Bare `trux` → `status`, plus a one-line hint: `open · pair · resume · help`.

```
trux help
  Service:  status | start | stop | restart | logs | update
  Access:   open | pair [--link] | url | token
  Sessions: resume [query]
  Cloud:    fly <app>
  Remove:   uninstall [--purge]
```

## Pair: short code + braille QR

`trux pair` writes a single active code to `~/.trux/pair-code` (JSON: `{ code, expiresAt }`, 8-char Crockford base32, TTL 10 minutes). QR + printed link use `https://<publicHost>/p/<code>`.

Unauthenticated `GET /p/:code` on the backend: match live code → `302` to `/#token=<secret>`. Retries allowed until TTL.

Braille-cell terminal renderer (2×4 modules per character) targets ~8–12 lines. `trux pair --link` prints only the short URL.

Native pair screen resolves `/p/<code>` URLs by following the redirect Location to extract `#token=`.

## Open

1. Load config (quiet dotenv)
2. Start `trux.service` if inactive (skip when no systemd; just poll)
3. Poll `http://127.0.0.1:<port>/health` up to ~10s
4. `xdg-open http://localhost:<port>/#token=<secret>` (or print URL)

## Package filters

- Shim `update` → `--filter @trux/mobile build:web`
- Service template / ExecStart → `--filter @trux/backend start`
- Access commands → `--filter @trux/backend exec tsx src/cli.ts …`

## Out of scope

Desktop responsive shell (D2), handoff REST beyond existing `resume.ts`, Fly provisioner rewrite, Electron/Tauri, changing `TRUX_SECRET` length.
