# Trux — Development Roadmap

*Companion to [the design spec](./2026-06-16-trux-design.md). Phases are dependency-ordered; each
ends in something you can **see working** — that "done when" is the steering checkpoint. Check items
off as they land.*

**Scope mapping:** v1 = Phases 0–3 · Next = Phases 4–7 · Deferred = Later.
**Steering checkpoints:** ⭐ after Phase 3 (useful locally) · ⭐ after Phase 5 (useful from the phone).

---

## Phase 0 — Skeleton & protocol
*The spine everything hangs on.*

- [x] pnpm monorepo: `packages/protocol`, `apps/backend`, `apps/frontend`
- [x] `@trux/protocol` — the NCP types (events both directions), shared by backend + frontend
- [x] Backend skeleton: Node + Fastify/Hono, `ws` wired, `better-sqlite3` init, config from env
- [x] Frontend skeleton: React + Vite, opens the WebSocket
- **Done when:** frontend connects to backend, a hello NCP message round-trips, runs locally. ✓ 2026-06-16

## Phase 1 — Claude chat, end-to-end
*The first usable thing.*

- [x] Claude adapter — `@anthropic-ai/claude-agent-sdk` `query()` streaming-input → NCP (`text`, `tool_call`, `tool_result`, `result`)
- [x] ConversationRegistry (sqlite); create a conversation bound to a `cwd`; persist transcript
- [x] Chat UI: compose box, send `user_message`, render streaming text + tool calls; conversation list
- [x] Run Claude in a **permissive tool mode** for now (approvals are Phase 2)
- [x] Minimal bearer auth (first-message WS) — fine to keep local for now
- **Done when:** locally, you prompt Claude in a real repo, watch it work, and it survives reload. ✓ 2026-06-16 *(verified live: prompted Claude in the trux repo, watched the streaming response render; reload-persistence covered by integration tests)*

## Phase 2 — Control: approvals + interrupt
*Makes it safe to drive real work.*

- [x] `canUseTool` → `approval_request`; approval cards in UI (Allow / Deny / Always) → `approval_response`
- [x] Interrupt a running turn (button → `interrupt` → SDK interrupt)
- [x] Status states surfaced (idle / thinking / awaiting_approval / error)
- **Done when:** Claude asks permission, you answer from the UI, and you can cancel a runaway turn. ✓ 2026-06-16 *(verified live: Deny blocked a Bash write and Claude recovered, Allow executed it and created the file; required settingSources:[] so trux owns permissions)*

## Phase 3 — Local dev loop: preview + verification  ⭐
*Closes the full loop at the desk.*

- [x] Render image `tool_result`s (agent Playwright screenshots show inline — Mode B)
- [x] Per-conversation **port registry** (agent announces / trux detects the dev-server port)
- [x] "Open preview" → `localhost:<port>` in a new tab (Mode A, local)
- **Done when:** you ask Claude for a UI change, see its screenshot inline *and* click through to the live app. ✓ 2026-06-16 *(verified live: trux detected the dev-server port and Open preview opened it; an image tool_result rendered inline)*
- **⭐ Milestone: trux is genuinely useful at the desk (Claude-only v1 = Phases 0–3). ✓ 2026-06-16**

## Phase 4 — More agents
*The multiplexer becomes real.*

- [x] Codex adapter (`codex exec --json`; `workspace-write` sandbox; multi-turn via `exec resume`) *(impl complete + 68 backend tests 2026-06-16; awaiting live run)*
- [x] opencode adapter (`@opencode-ai/sdk`; full permission request/respond) *(impl complete + 82 tests 2026-06-16; awaiting live run)*
- [x] Agent picker on new-conversation (`claude` / `codex` / `opencode`)
- **Done when:** you drive a conversation with any of the three through the same UI. *(claude ✓ live; opencode pending live; codex = 4c)*

## Phase 5 — Remote: deploy + phone  ⭐
*Unchain from the desk.*

- [x] Harden config (`assertConfig` startup guard; `TRUX_AUTH=1` requires `TRUX_SECRET`; `TokenGate` UI on 401)
- [x] Tailscale access; real bearer auth (`TRUX_TAILSCALE_HOST`; `GET /config`; wss: fix)
- [x] Remote preview via `TRUX_TAILSCALE_HOST` + port registry (Tailscale URL when configured)
- [x] PWA install (`manifest.json`, `sw.js`, icons, Apple meta tags); mobile-responsive polish (100dvh, sticky composer, safe-area, 44px touch targets, auto-resize textarea)
- [x] systemd user unit + `enable-linger` + `deploy/setup.sh` one-shot installer
- **Done when:** you drive a real conversation from your phone over Tailscale, approve tools, preview the app. *(impl complete 2026-06-16; awaiting live Tailscale run)*
- **⭐ Milestone: the genesis — dev from your pocket. (pending live verification)**

## Phase 6 — Continuity & polish
- [x] Adopt/resume sessions started at the desk (`~/.claude/projects/`; `session.list` for codex/opencode)
- [x] Image attachments (user → agent); saved prompt snippets; conversation search / archive / rename
- **Done when:** start a conversation at the desk, continue it on the phone. ✓ 2026-06-17

## Phase 6.5 — QR pairing
*Persona settled (2026-06-17): build for me, over Tailscale. The remaining phone friction is typing
the bearer token — QR removes it. (mDNS dropped: redundant with Tailscale MagicDNS; Cloudflare
Tunnel deferred to Later — no public door needed on Tailscale.)*

- [x] **QR pairing** — box/desktop shows a QR encoding the Tailscale URL (`https://<host>.<tailnet>.ts.net`) + bearer token; scan on the phone → paired, no manual token entry *(borrowed from CCPocket)* *(impl complete + 8 tests 2026-06-17; awaiting live phone scan)*
- **Done when:** scan a QR at the desk and the phone is connected over Tailscale with no typed token. *(code path done; pending live phone verification)*

## Phase 7 — Provisioner (the bigger, decoupled work)
*Runtime never depends on this; it can land anytime.*

- [ ] `trux provision --cloud gcp|aws` — Terraform + cloud-init: VM + networking, install Node + agent CLIs, clone repo, start service
- [ ] Stateless / one-command teardown; least-privilege creds
- [ ] Guided one-time agent-login step (`claude` / `codex` / `opencode` OAuth) per environment
- **Done when:** one command stands up a trux box in your cloud from nothing.

## Later (deferred)
- [ ] Integrated preview proxy — subdomain-per-conversation, HMR-websocket-aware
- [ ] Embedded split-view (chat + live app)
- [ ] Native mobile app + push notifications (agent needs you) — one transport option is **embedded tsnet** (the app *is* its own tailnet node → no separate Tailscale install, still no server in path); vs. the relay path if even one install is a dealbreaker
- [ ] Voice input; cost / usage dashboards
- [ ] Worktree creation from the UI; multi-root workspaces
- [ ] **Cloudflare Tunnel** (+ E2E relay) — bare-browser / no-install remote access for *non-coder* users; not needed while it's just-me on Tailscale *(deferred — revisit when handing trux to someone who can't install Tailscale)*
- [ ] **Docker image** — Windows runtime (Docker Desktop/WSL2) + preinstalled / new-machine package; bearer secret on **first boot**, never baked *(deferred — Windows not an immediate concern)*
- [ ] **Local-model lane** (via opencode) — no-OAuth plug-and-play; the one case where tunnel privacy bites → layer app-E2E *(deferred — not an immediate concern)*
