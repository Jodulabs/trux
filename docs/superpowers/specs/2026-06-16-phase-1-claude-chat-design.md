# Phase 1 — Claude chat, end-to-end (Design Spec)

*Companion to [the design spec](../../2026-06-16-trux-design.md) and
[roadmap](../../2026-06-16-trux-roadmap.md). Builds on the Phase 0 skeleton
(monorepo, `@trux/protocol`, backend WS auth + hello, frontend WS client).*

**Status:** approved design, not yet implemented.

---

## 1. Goal & "done when"

Make trux usable for the first time with a single agent. Locally, you:

1. Pick `claude` + a `cwd` from a **workspace picker**, create a conversation.
2. Prompt Claude in that real repo and watch **streaming** assistant text plus
   collapsible **tool calls / results**.
3. **Interrupt** a runaway turn.
4. Reload the browser and the **transcript survives** (re-fetched from sqlite).

Approvals run **permissive** (`bypassPermissions`) in Phase 1 — interactive
approvals are Phase 2. Cross-conversation live status push, image attachments,
and backend-restart session resume are explicitly deferred (§9).

This realises roadmap Phase 1:
- Claude adapter — `@anthropic-ai/claude-agent-sdk` `query()` streaming-input → NCP.
- ConversationRegistry (sqlite): create a conversation bound to a `cwd`; persist transcript.
- Chat UI: compose box, `user_message`, render streaming text + tool calls; conversation list.
- Permissive tool mode.
- Bearer auth (already delivered in Phase 0).

---

## 2. Verified facts — Claude Agent SDK (TypeScript)

*(verified 2026-06-16 against `code.claude.com/docs/en/agent-sdk/typescript`)*

- **Streaming input mode:** `query({ prompt, options })` where `prompt` is an
  `AsyncIterable<SDKUserMessage>`. Yield
  `{ type: 'user', message: { role: 'user', content: string }, parent_tool_use_id: null }`
  per turn; the same `query()` stays alive across turns.
- **Yielded message types:** `assistant`, `user`, `result`, `system`, and
  `partial_assistant` (only when `includePartialMessages: true`).
- **session_id:** present on `assistant` / `result` messages, or via
  `await q.initializationResult()`.
- **Control (streaming mode only):** `q.interrupt()`, `q.setPermissionMode()`,
  `q.close()`.
- **Permission modes:** `default | acceptEdits | bypassPermissions | plan |
  dontAsk | auto`. Phase 1 uses `bypassPermissions`.
- **Options:** `cwd`, `resume: <sessionId>`, `includePartialMessages`.

These facts fix the adapter shape in §5. They are time-sensitive — re-check
before relying.

---

## 3. Protocol additions (`@trux/protocol`)

NCP **wire events are unchanged** (the Phase 0 `ServerEvent` / `ClientMessage`
unions already cover the streamed turn). `parseClientMessage` already validates
`user_message` / `interrupt` / `approval_response`, so the inbound path needs no
change.

Add **REST DTOs** (a new `rest.ts`, re-exported from `index.ts`) shared by both
ends so REST payloads are compile-checked like the WS contract:

```ts
export interface Worktree { path: string; branch: string | null }
export interface Workspace { root: string; worktrees: Worktree[] }

export type AgentName = 'claude' | 'codex' | 'opencode'

export interface Conversation {
  id: string
  agent: AgentName
  cwd: string
  title: string | null
  status: ConversationStatus
  native_session_id: string | null
  archived: boolean
  created_at: number
  updated_at: number
}

export interface StoredEvent { seq: number; event: ServerEvent }

// POST /conversations body
export interface CreateConversationRequest { agent: AgentName; cwd: string; title?: string }
// GET /conversations/:id response
export interface ConversationDetail { conversation: Conversation; transcript: StoredEvent[] }
```

---

## 4. Backend modules

Each module owns one concern and is composed in `index.ts`. New files under
`apps/backend/src/`:

| Module | Responsibility |
|---|---|
| `registry.ts` | sqlite CRUD over `conversations` + `events`. `createConversation`, `listConversations`, `getConversation`, `setStatus`, `setNativeSessionId`, `archiveConversation`, `appendEvent(convId, event) → seq`, `loadTranscript(convId) → StoredEvent[]`. Owns per-conversation `seq` allocation. |
| `workspaces.ts` | `listWorkspaces(roots) → Workspace[]`: for each root run `git worktree list --porcelain`; if not a git repo, the root is its own single entry with `branch: null`. |
| `adapter/types.ts` | The `AgentAdapter` interface + supporting types (`AgentSession`, `AdapterEvent`). |
| `adapter/claude.ts` | `ClaudeAdapter` over `@anthropic-ai/claude-agent-sdk`. |
| `manager.ts` | `ConversationManager`: live sessions keyed by conversation id; bridges WS ↔ adapter ↔ registry; owns turn lifecycle + `turn_id`. |
| `routes/conversations.ts`, `routes/workspaces.ts` | REST handlers. |
| `stream.ts` | The WS turn engine (replaces Phase 0's "not implemented in phase 0" branch in `server.ts`). |

`server.ts` is refactored so `buildServer(config, db, manager)` registers the
REST routes and the WS turn engine; the auth gate and `hello` handshake from
Phase 0 are preserved.

### 4.1 AgentAdapter interface

Trimmed from the design's full interface to what Phase 1 exercises (approvals
land in Phase 2). The seam is real so codex/opencode slot in at Phase 4.

```ts
export interface AgentAdapter {
  readonly name: AgentName
  start(opts: { cwd: string; resume?: string }): AgentSession
}

export interface AgentSession {
  send(text: string): void                 // enqueue a user turn
  events(): AsyncIterable<ServerEvent>      // normalized NCP events (no turn_id yet; manager stamps it)
  interrupt(): Promise<void>
  close(): Promise<void>
  nativeSessionId(): string | null          // captured once known
}
```

The adapter emits NCP events **without `turn_id`/`seq`** — `turn_id` is a
conversation concern the manager stamps, `seq` is allocated by the registry. To
keep types honest the adapter yields a local `AdapterEvent` (the `ServerEvent`
variants minus the `turn_id` field); the manager adds `turn_id` to produce the
wire `ServerEvent`.

### 4.2 Registry seq & status

`appendEvent` allocates `seq` as `MAX(seq)+1` per conversation inside a
transaction, stores `type` + JSON `payload`, returns the row as `StoredEvent`.
`loadTranscript` returns events ordered by `seq`. `setStatus` mirrors the latest
`status` event onto the conversation row so the sidebar (REST list) shows a
last-known status without a live socket.

---

## 5. Claude adapter internals (the crux)

```ts
class ClaudeAdapter implements AgentAdapter {
  name = 'claude' as const
  start({ cwd, resume }) {
    const inbox = new PushQueue<SDKUserMessage>()   // async-generator-backed queue
    const q = query({
      prompt: inbox.iterable(),
      options: { cwd, permissionMode: 'bypassPermissions',
                 includePartialMessages: true, resume },
    })
    return new ClaudeSession(q, inbox)
  }
}
```

- **Input** — `send(text)` pushes
  `{ type:'user', message:{ role:'user', content:text }, parent_tool_use_id:null }`
  into `inbox`. The queue's async iterator yields enqueued messages and awaits
  the next, so one `query()` lives for the whole conversation.
- **Output** — `events()` async-iterates `q` and maps:

  | SDK message | NCP `AdapterEvent` |
  |---|---|
  | `system` / `assistant` `session_id` (first seen) | captured → `nativeSessionId()` |
  | `partial_assistant` text delta | `text_delta` |
  | `assistant` content `text` block | `text` |
  | `assistant` content `tool_use` block | `tool_call` (`tool_id`, `name`, `input`) |
  | `user` content `tool_result` block | `tool_result` (`tool_id`, `status`, `output`) |
  | `result` | `turn_complete` (`usage`, `cost`) |
  | thrown error | `error` (`recoverable: true`) |

- **interrupt()** → `q.interrupt()`; **close()** → `q.close()`.
- The adapter never emits `turn_started` / `status` — those are turn-lifecycle
  events the **manager** emits around the adapter stream (§6).

### Testability
`query` is injected (constructor param defaulting to the real SDK `query`) so
unit tests drive a **fake async-generator** through the full mapping table with
no network or real Claude process.

---

## 6. ConversationManager & turn lifecycle

The manager is the single bridge. Per conversation it holds at most one live
`AgentSession` (created lazily on the first `user_message`).

```
on user_message(convId, text):
  session = ensureSession(convId)            // start adapter with conv.cwd, resume if known
  turn_id = newTurnId()
  emit(convId, { turn_started, turn_id })            // persist + stream
  emit(convId, { status: 'thinking' })
  session.send(text)
  // a per-session pump loop is already draining session.events():
  for await (e of session.events()):
      const wire = stampTurn(e, turn_id)
      if wire.type !== 'text_delta':
          registry.appendEvent(convId, wire)         // persist FIRST (durable events)
      broadcast(convId, wire)                         // THEN stream to the open socket
      if wire.type === 'turn_complete':
          emit(convId, { status: 'idle' }); registry.persist nativeSessionId
```

- **One pump per session**, started when the session is created, not per turn —
  it continuously drains `events()`. `turn_id` for each emitted event is the id
  of the currently-open turn (tracked on the session).
- **`text_delta` is ephemeral — broadcast-only, never persisted.** The design's
  rule is that the *assembled* `text` block is the persisted record; deltas only
  give the live "typing" feel. On reload, the persisted `text` reconstructs the
  message; a reconnect mid-turn resumes live deltas from that point. Every other
  event is **persist-before-broadcast**, making the sqlite transcript the source
  of truth: a reload mid-turn replays every durable event written so far, then
  the live socket resumes.
- **interrupt(convId)** → `session.interrupt()`. The in-flight `result` (or an
  `error`) still closes the turn and flips status to `idle`/`error`.
- **Broadcast** targets the socket(s) currently attached to that conversation id
  (Phase 1: at most one). If none is attached, events are still persisted.

---

## 7. Data flow (end to end)

```
POST /conversations {agent:'claude', cwd, title?}     → row, status idle
WS  /conversations/:id/stream → auth → hello (Phase 0 path, unchanged)
client → user_message "…"
  manager.ensureSession → ClaudeAdapter.start(cwd)    (lazy, once per conversation)
  manager opens turn, session.send(text)
  pump: SDK msgs → NCP → registry.appendEvent → broadcast
client → interrupt → session.interrupt()
reload:
  GET /conversations/:id → { conversation, transcript: StoredEvent[] }
  frontend replays transcript, then reconnects WS for subsequent turns
```

---

## 8. Frontend

- **`api.ts`** — typed REST client: `listWorkspaces`, `listConversations`,
  `createConversation`, `getConversation`. Uses the shared DTOs.
- **`store.ts`** (Zustand) — `conversations[]`, `currentId`, `transcripts:
  Record<id, ServerEvent[]>`, `connState`, actions. NCP events fold into the
  current transcript: `text_delta` appends to the open assistant text block;
  `tool_call` / `tool_result` pair by `tool_id`; `status` updates the
  conversation; `turn_complete` closes the turn.
- **`truxClient.ts`** (extended from Phase 0) — add `sendUserMessage(text)` and
  `interrupt()`; dispatch every inbound event into the store. Existing
  auth-on-open + `onReady(hello)` preserved.
- **Components:**
  - `Sidebar` — conversation list (agent badge + status dot) + "New conversation".
  - `NewConversationDialog` — agent fixed to `claude`; workspace/worktree picker
    fed by `GET /workspaces`; on submit `POST /conversations` then opens it.
  - `ConversationView` → `Transcript` (renders `text`, streamed `text_delta`,
    collapsible `tool_call`/`tool_result`) + `Composer` (multiline textarea →
    `user_message`; **Interrupt** button shown while status is `thinking`).
- On selecting a conversation: `getConversation` to hydrate the transcript, then
  connect that conversation's WS for live turns.

---

## 9. Explicitly deferred (keep Phase 1 tight)

- Interactive approvals → **Phase 2** (runs `bypassPermissions` now).
- Live cross-conversation status push → sidebar shows persisted status from REST
  plus live status for the **open** conversation only.
- Backend-restart session resume (the `resume:` wiring exists in the adapter but
  is not driven on startup) → later.
- Image attachments, saved snippets, conversation search / rename polish → Next.

---

## 10. Testing strategy

| Unit | How |
|---|---|
| `registry` | in-memory sqlite; seq allocation, transcript order, status mirror. |
| `workspaces` | temp git repos / non-repo dirs; worktree enumeration + degrade. |
| `adapter/claude` mapping | injected fake `query()` async generator → assert NCP event sequence across the whole mapping table. |
| `manager` | fake `AgentAdapter` → assert turn lifecycle (`turn_started`/`status`/stamping/`turn_complete`), persist-before-broadcast, interrupt. |
| WS + REST integration | real Fastify + a fake adapter injected into the manager; full round-trip incl. reload-replay. |
| Frontend store | event-folding reducers. |
| Frontend components | Vitest + Testing Library with a stubbed client. |

The **real-SDK end-to-end** (live Claude in a real repo) is a manual
verification task, not an automated test.

---

## 11. Module boundaries (why this shape)

- `protocol` stays the only wire/REST contract; adding REST DTOs there keeps both
  ends compile-checked.
- The **adapter** owns *only* native→NCP translation and the agent process; it
  knows nothing about sockets, sqlite, or `turn_id`.
- The **manager** owns turn lifecycle, persistence ordering, and fan-out; it
  knows nothing about Claude specifics.
- The **registry** owns storage and `seq`; the **routes/stream** own transport.
- This is the design's intended separation (adapters translate; backend owns WS,
  registry, auth, persistence) made concrete for one agent, with the seam ready
  for codex/opencode.
