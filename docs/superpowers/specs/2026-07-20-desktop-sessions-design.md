# Desktop Sessions — continue anywhere — Design Spec

**Status:** design, pending implementation plan
**Date:** 2026-07-20
**Scope:** Give a trux conversation the same first-class status on the desktop it has on the phone: a desktop-shaped web surface, terminal handoff in both directions (trux ↔ native CLI), and multi-device polish. Sessions already live server-side — this spec adds **no new session model**; it surfaces the one that exists. Completes the Phase 6 continuity goal ("Start a conversation at the desk, continue it on the phone", `2026-06-16-phase-6-continuity-design.md:9`) in the other direction.

---

## Key finding: sessions are already portable

The gap is not sync — the backend already owns everything a second device needs:

- **Server-side sessions.** Conversations + append-only, per-conversation-sequenced transcripts live in SQLite on the box (`db.ts:10-33`, `registry.ts`). The phone is only a rendering client.
- **Resume protocol.** A (re)connecting client sends `resume { since_seq }` and receives `history_delta`, or `history_snapshot` past 200 missed events (`events.ts:158-162`, `stream.ts:63-66`, `manager.ts:149-159`). Per-device progress is tracked client-side (`connectionManager.ts:40` keeps `lastSeq` per conversation).
- **Multi-client attach.** `ConversationManager.listeners` is a `Map<convId, Set<Listener>>` (`manager.ts:69,77-82`) — phone and desktop can watch the same turn live, today.
- **A desktop client exists in embryo.** `expo export -p web` is served by the backend; `trux open` hands the token over via `#token=` fragment (`ports.web.ts:21-27`). Open the tailnet URL in a desktop browser, sign in, and every conversation is continuable right now — in a phone-shaped UI.
- **Desktop-CLI → trux adoption exists.** `GET /sessions/discover` scans `~/.claude/projects/<folder>` and `~/.codex/sessions/` (`routes.ts:19-102,124-130`); `native_session_id` on create resumes it (`registry.ts:56-79`, `manager.ts:193-197`); the picker ships in `app/(app)/new.tsx:84-89`.
- **trux → desktop-CLI mapping is persisted but never used.** `native_session_id` is stored after every turn (`manager.ts:231-233`) and exposed on the REST `Conversation` (`rest.ts:55`). Nothing reads it.

**What's missing:** a desktop-shaped surface; the handoff direction *into* the native terminal; handoff safety (idle-only); a server-enforced single-driver guard; a pasteable pairing link; desktop web-push.

## Carry-over matrix

| Direction | Mechanism | Status |
|---|---|---|
| phone → desktop browser | same server session; resume protocol | works today (D2 makes it good) |
| desktop browser → phone | same server session; resume protocol | works today |
| desktop native CLI → trux | session discovery + `native_session_id` on create | works today (claude/codex) |
| trux → desktop native CLI | **handoff endpoint + `trux resume`** | **D1 — new** |

---

## Governing principles

**1. One session, many surfaces.** The backend stays the single source of truth; desktop is another client of the same REST + WebSocket contract ("surface-agnostic backend", `2026-06-16-trux-design.md:124`). No sync protocol, no CRDT, no per-device state, no server in the middle.

**2. The native session id is the handoff currency.** `native_session_id` (the Claude jsonl session id / codex thread id) is what lets a conversation move between trux and the native CLI in either direction. Both sides read and append the same on-disk session, so context is never copied, exported, or translated. trux never forks implicitly.

**3. Idle-only handoff.** A conversation changes driver only when `status === 'idle'` — never mid-turn, never while `awaiting_approval`. Handoff is a convention enforced by the status gate, not a file lock on the agent's session storage.

**4. Desktop is web-first.** The desktop surface is the same Expo web bundle with a responsive layout branch — not a new app, runtime, or shell. No Electron/Tauri.


---

## Architecture overview

```
 phone PWA ─┐
            │  WS /conversations/:id/stream (auth-first, resume since_seq)
 desktop ───┤────────────────────────────────┐
 browser    │                                ▼
            │                     ┌───────────────────────┐     ┌────────────────┐
            ├── REST (Bearer) ───▶│  trux backend (box)   │────▶│ AgentAdapter   │
            │                     │  registry (sqlite)    │     │ claude/codex/… │
 desktop ───┤                     │  manager (multiplex)  │     └──────┬─────────┘
 terminal   │                     └───────┬───────────────┘            │
 (trux      │                             │ handoff:                   │ resume
  resume) ──┴── reads registry db ────────┘  claude --resume <sid>     ▼
                          same native session files (~/.claude/projects, ~/.codex/sessions)
```

All desktop surfaces ride the existing token boundary (`auth.ts`, `routes.ts:112-118`). `trux resume` runs *on the box* (over SSH or locally) and reads the same registry DB the server uses — no new transport.

---

# Phase D1 — Terminal handoff (backend + `trux resume`)

Push a trux conversation into the native desktop CLI, and back.

- **`GET /conversations/:id/handoff`** (new route in `routes.ts`, behind the existing Bearer gate):
  - `404` unknown conversation; `409 { error: 'busy' }` unless `status === 'idle'`; `422 { error: … }` when the conversation has no `native_session_id` yet (never ran a turn) or the agent is unsupported.
  - `200 { agent, cwd, nativeSessionId, command }` where `command` is an argv array:
    - claude → `['claude', '--resume', sid]` (the SDK's `resume` option is what the adapter passes, `adapter/claude.ts:302-304,338`; the CLI flag continues the same jsonl)
    - codex → `['codex', 'resume', tid]` — interactive counterpart of the adapter's `codex exec resume --json <tid>` (`adapter/codex.ts:48-50`); exact TUI flag verified at plan time
    - opencode → `422` this phase (no documented resume flag or discovery API — same stance as Phase 6)
- **`trux resume [query]`** in `bin/trux`, dispatching to `pnpm --filter backend resume -- <query>` (mirrors the `pair` wiring). A small backend script opens the same DB (`TRUX_DB_PATH` / `~/.trux/trux.db`, `config.ts:41`), lists non-archived conversations newest-first (title, agent, cwd, status, relative `updated_at`), applies the optional substring filter, and on selection execs `cd <cwd> && <command>` with inherited stdio. Busy conversations are listed but refused. Works over plain SSH — no browser involved.
- **Round trip:** after CLI work, the native session file has grown; trux's next turn resumes the same id, so the phone inherits the CLI-continued context untouched. `claude --fork-session` remains a manual user escape hatch — trux's default is continue, never fork.
- **Concurrency model:** the human drives one surface at a time; the idle gate plus D2's single-driver guard (below) make concurrent trux+CLI ownership of one native session unreachable through trux itself. trux does not lock the agent's files.

## Phase D1 testing

`routes.test.ts`-pattern coverage: handoff 200/409/422/404; per-agent command mapping; unknown agent. CLI script: temp-DB fixture test (mirrors `commands.test.ts`/`routes.test.ts` fixtures) for list/filter/refuse-busy and the emitted command line.

---


# Phase D2 — Desktop web surface (responsive layout in the Expo app)

Same routes, same store, desktop shape.

- **Layout branch.** `app/(app)/_layout.tsx` branches on `Platform.OS === 'web' && useWindowDimensions().width >= 1024` → renders `<DesktopShell>` (new): persistent left sidebar + `<Slot/>` as the main pane. Native and narrow web keep today's stack untouched. One route tree means deep links and push-notification clicks (`/session/<id>`) keep working unchanged.
- **Sidebar** (`src/components/desktop/Sidebar.tsx`): conversation list reusing existing store selectors (`conversations`, `convMeta` status dots / unread / cost — the same data `app/(app)/index.tsx:61-63` renders), search box → `api.searchConversations`, `+` → `/new`, footer → `/settings` + `/connections`. `index.tsx` at desktop width renders a "Select a conversation" empty state; `session/[id].tsx` renders `ConversationView` as today, with `GitPanel` / `TerminalPane.web` / `PreviewPane.web` as right-dock tabs instead of bottom sheets (web pane variants already exist).
- **Composer:** Enter sends, Shift+Enter newline, on web only. The existing `CommandPalette` (⌘K) stays reachable from the desktop shell.
- **Single-driver guard (server-enforced).** `manager.handleUserMessage` currently starts a turn unconditionally (`manager.ts:92-128`); with two surfaces attached, a send while `thinking`/`awaiting_approval` would run a parallel turn — codex would spawn a second proc on the same thread (`adapter/codex.ts:47-50`). Add: reject with a recoverable `error` event ("conversation busy") when status is not idle. Composers already disable on busy; this makes it authoritative. Additive, NCP-compatible (no new event types).
- **Live multi-view stays.** Two surfaces *watching* one conversation needs no change — the manager already broadcasts every persisted event to all attached sockets; each client resumes from its own `lastSeq`.

## Phase D2 testing

jest-expo component tests for the layout branch (mock `Platform`/`useWindowDimensions`; narrow → stack, wide-web → shell) mirroring `_layout.test.tsx`/`index.test.tsx`; sidebar store-driven tests; manager busy-guard unit test in `manager.test.ts` (send while thinking → recoverable error, no second `turn_started`).

---

# Phase D3 — Presence, pairing link, desktop push (small polish)

- **`trux pair --link`:** print the `https://<host>/#token=…` URL the QR already encodes (`banner.ts:38`) so it can be pasted into a desktop browser or another laptop — the fragment-capture sign-in path already exists (`ports.web.ts:21-27`).
- **Desktop web-push:** extend the existing subscribe flow to the web build. Subscriptions are already owner-wide (`db.ts:38-46`, `routes.ts:179-199`) and payloads already carry the conversation id for deep-linking; a desktop browser just needs the SW `pushManager` path wired. Verify what survived the Expo web convergence (`2026-06-22-phase-e-converge-web-onto-expo.md`) at plan time.
- **Optional presence:** additive `clients` event (attached-count per conversation) so a surface can show "also open elsewhere". Only if it stays a few lines in `manager.attach`/`stream.ts` — cut otherwise.

## Phase D3 testing

Banner output test for `--link`; web subscribe test with a mocked SW registration; presence event schema test only if taken.

---

## Non-goals

- **No native desktop app** (Electron/Tauri) and no separate desktop codebase — the desktop surface is the Expo web bundle.
- **No new sync machinery** — no CRDT, no operational transform, no relay. The event log + resume protocol already cover it.
- **No mid-turn handoff** and no session-fork UI (`--fork-session` stays manual).
- **No opencode terminal handoff** until opencode documents a resume/discovery API (mirrors Phase 6's stance).
- **No locking of agent session files** — idle-gate by convention.
- **No changes to the conversation/event model** — additive REST route + client/UI work only.

## Open items resolved at plan time

- Desktop breakpoint (1024?) and right-dock shape (tabs vs split).
- `trux resume` picker UX (fzf when present vs numbered list) and exec mechanics from the bash shim (`exec` vs node `stdio: inherit`).
- codex interactive-resume flag against the installed codex version (trux uses `exec resume`; confirm the TUI equivalent).
- Web-push path on Expo web (SW registration → `pushManager`), per the phase-E convergence state.
- Busy-guard UX: immediate composer error vs client-held message (lean: immediate, recoverable).

## Files changed (cumulative)

| File | Action |
|---|---|
| `packages/protocol/src/rest.ts` | `HandoffResponse` type |
| `apps/backend/src/routes.ts` | `GET /conversations/:id/handoff` + per-agent command mapping |
| `apps/backend/src/manager.ts` | single-driver guard in `handleUserMessage` |
| `apps/backend/src/resume.ts` | NEW — `trux resume` listing/selection/exec driver |
| `apps/backend/package.json` | `resume` script |
| `bin/trux` | `resume` subcommand |
| `apps/backend/src/banner.ts` | `pair --link` prints the fragment URL |
| `apps/mobile/app/(app)/_layout.tsx` | web-wide branch → `DesktopShell` |
| `apps/mobile/src/components/desktop/DesktopShell.tsx` | NEW — sidebar + slot + right dock |
| `apps/mobile/src/components/desktop/Sidebar.tsx` | NEW |
| `apps/mobile/app/(app)/index.tsx` | desktop empty-state at wide width |
| `apps/mobile/app/(app)/session/[id].tsx` | panels as right-dock tabs at wide width |
| `apps/mobile/src/components/Composer.tsx` | Enter-to-send on web |
| `apps/mobile/src/notifications.ts` | web pushManager subscribe path |
| `apps/backend/test/routes.test.ts` | handoff coverage |
| `apps/backend/test/manager.test.ts` | busy-guard coverage |
| `apps/backend/test/resume.test.ts` | NEW — CLI driver coverage |
| `docs/2026-06-16-trux-roadmap.md` | new Phase 8 — Desktop sessions |

