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
- **Done when:** Claude asks permission, you answer from the UI, and you can cancel a runaway turn. *(implementation complete + 53 tests incl. WS approval round-trip, verified 2026-06-16; awaiting live Claude run to tick this line)*

## Phase 3 — Local dev loop: preview + verification  ⭐
*Closes the full loop at the desk.*

- [ ] Render image `tool_result`s (agent Playwright screenshots show inline — Mode B)
- [ ] Per-conversation **port registry** (agent announces / trux detects the dev-server port)
- [ ] "Open preview" → `localhost:<port>` in a new tab (Mode A, local)
- **Done when:** you ask Claude for a UI change, see its screenshot inline *and* click through to the live app.
- **⭐ Milestone: trux is genuinely useful at the desk (Claude-only v1 = Phases 0–3).**

## Phase 4 — More agents
*The multiplexer becomes real.*

- [ ] Codex adapter (`codex exec --json`; policy/sandbox approvals; degrade gracefully)
- [ ] opencode adapter (`@opencode-ai/sdk`; full permission request/respond)
- [ ] Agent picker on new-conversation (`claude` / `codex` / `opencode`)
- **Done when:** you drive a conversation with any of the three through the same UI.

## Phase 5 — Remote: deploy + phone  ⭐
*Unchain from the desk.*

- [ ] Harden config (TLS / auth required modes); systemd `dev`-user unit; `enable-linger`
- [ ] Tailscale access; real bearer auth
- [ ] Remote preview via **Tailscale serve** + port registry
- [ ] PWA install; mobile-responsive polish; mobile compose / approve ergonomics
- **Done when:** you drive a real conversation from your phone over Tailscale, approve tools, preview the app.
- **⭐ Milestone: the genesis — dev from your pocket.**

## Phase 6 — Continuity & polish
- [ ] Adopt/resume sessions started at the desk (`~/.claude/projects/`; `session.list` for codex/opencode)
- [ ] Image attachments (user → agent); saved prompt snippets; conversation search / archive / rename
- **Done when:** start a conversation at the desk, continue it on the phone.

## Phase 7 — Provisioner (the bigger, decoupled work)
*Runtime never depends on this; it can land anytime.*

- [ ] `trux provision --cloud gcp|aws` — Terraform + cloud-init: VM + networking, install Node + agent CLIs, clone repo, start service
- [ ] Stateless / one-command teardown; least-privilege creds
- [ ] Guided one-time agent-login step (`claude` / `codex` / `opencode` OAuth) per environment
- **Done when:** one command stands up a trux box in your cloud from nothing.

## Later (deferred)
- [ ] Integrated preview proxy — subdomain-per-conversation, HMR-websocket-aware
- [ ] Embedded split-view (chat + live app)
- [ ] Native mobile app + push notifications (agent needs you)
- [ ] Voice input; cost / usage dashboards
- [ ] Worktree creation from the UI; multi-root workspaces
