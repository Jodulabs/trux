# Trux — Design Spec

*Status: design, not yet implemented. Supersedes the earlier "Mobile Dev Terminal" framing
(terminal / tmux / pty relay), which was a wrong turn — see [Background](#background--what-this-replaces).*

---

## Essence

**Trux is a self-hosted interface for driving coding agents against your own code.**

You develop by **typing/prompting** — not by opening an editor — and the agent works on your
**real repository**, on your **own server**, using your **own agent subscriptions**. Nothing
leaves your infrastructure.

It is the private, self-hosted counterpart to hosted agent-dev platforms (Lovable, Bolt, v0,
Replit Agent): the same type-to-develop experience, but the code and the compute are yours.

One chat interface, with the **agent as a parameter** — choose `claude`, `codex`, or `opencode`
per conversation and that backend drives it. Trux multiplexes several such conversations at once.
It is a **personal tool**: built for one developer, his box, his repos, his subscriptions — not
generalised for other users.

---

## Background — what this replaces

Trux began as "a mobile terminal to drive agents over SSH + tmux." That framing mistook the
*mechanism* (a terminal) for the *product* (prompting an agent). The realisations that turned it
around:

- The experience wanted is **chat/prompt**, not a terminal. A terminal on a phone is the painful
  thing to avoid, not the goal.
- A terminal is not a text field; a chat interface needs **structured** turns (message, tool
  call, approval request), which raw terminal bytes cannot provide.
- Each target agent already exposes a **structured, persistent, programmatic** mode — the Claude
  **Agent SDK** (streaming input), Codex **`exec --json`**, the opencode **server API** — which
  is exactly what a chat interface consumes. No terminal, tmux, or pty is required.

So trux is not a terminal multiplexer. It is a chat front-end over each agent's official
programmatic interface.

---

## What it is / isn't

**Is:** a self-hosted, code-connected, multi-agent chat for type-to-develop work on your own box.

**Isn't:**
- a terminal, tmux relay, or pty bridge;
- a clone of the Claude/Codex *consumer chat apps* (those are for casual chat, not dev);
- a token-proxy that launders one subscription into another tool (ToS-violating — see
  [Subscription & legitimacy](#subscription--legitimacy-constraints));
- a relay / SaaS (no third party in the path);
- multi-user (single developer);
- an editor (you prompt; the agent edits files).

---

## Core concepts

### Conversation
The central object and the unit the multiplexer multiplexes. A conversation is:

| Field | Meaning |
|---|---|
| `id` | trux conversation id |
| `agent` | `claude` \| `codex` \| `opencode` — the backend that powers it |
| `cwd` | the working directory it is bound to (a repo or git worktree) — *code-connected* |
| `title` | human label (auto from first prompt, editable) |
| `status` | `idle` \| `thinking` \| `awaiting_approval` \| `error` |
| `native_session_id` | the underlying agent session id (for resume) |
| `created_at` / `updated_at` | timestamps |
| `archived` | soft-delete flag |

A conversation owns an ordered **transcript** of turns (user prompts + the normalized events the
agent produced). The transcript is trux's source of truth for rendering; the agent's native
session is the execution state.

### Agent backend (the parameter)
Each conversation is bound at creation to one agent. The agent runs under **its own official
login** on the box (`claude` OAuth, `codex` OAuth, opencode Zen/Go or API key). Trux never moves
credentials between agents.

### Code-connected (working directory)
Every conversation is bound to a `cwd` — a real repository or a git worktree on the box. The agent
operates there: reading/editing files, running the dev stack, running `git`/`gh`, invoking skills.
This is what makes it *development* and not abstract chat. Worktrees (e.g. `.worktrees/issue-*`)
fit naturally: one conversation per worktree.

### Multiplexer
Several conversations open at once, each bound to an `(agent, cwd)`. The sidebar shows them with a
per-conversation status so you can see, at a glance, which agent is **thinking**, which is
**awaiting your approval**, and which is idle — then jump in. That status roster is the deflated,
true meaning of "agent multiplexer": multiple *agent-backed chats*, not terminals.

---

## Architecture overview

```
  ┌─────────────────────────┐        REST (lifecycle, list)        ┌──────────────────────────┐
  │  Web PWA (responsive)   │ ───────────────────────────────────▶ │   Trux backend (Node+TS) │
  │  React + TS + Vite      │ ◀═══════ WebSocket (NCP events) ════▶ │   on your box, dev user   │
  │  chat UI, sidebar,      │                                       │                           │
  │  approvals, compose     │                                       │   ConversationRegistry    │
  └─────────────────────────┘                                       │   (sqlite + transcripts)  │
            ▲                                                        │            │              │
            │ home-screen install (PWA);                            │   AgentAdapter (per conv) │
            │ native mobile app later                               │   claude │ codex │ opencode│
            ▼                                                        └────────────┬──────────────┘
        your phone / laptop browser                                               │ official SDK/CLI,
                                                                                  │ own subscription
                                                                     ┌────────────▼──────────────┐
                                                                     │ Claude Agent SDK (TS)     │
                                                                     │ codex exec --json         │
                                                                     │ opencode server API       │
                                                                     │  → model, on your sub      │
                                                                     └───────────────────────────┘
```

- **Surface-agnostic backend.** Web and (later) native mobile are just clients of the same
  REST + WebSocket contract. Web-first wastes no backend work.
- **Everything runs on your box.** Code, compute, and credentials never leave.

---

## The Normalized Conversation Protocol (NCP)

The single contract the frontend renders and every adapter translates *into*. This is ours to
design; adapters map each agent's native events onto it. Carried over the WebSocket as JSON.

### Server → client (streamed)

```jsonc
{ "type": "turn_started",   "turn_id": "t_12" }
{ "type": "text_delta",     "turn_id": "t_12", "text": "Looking at the auth module" }   // streaming
{ "type": "text",           "turn_id": "t_12", "text": "Full assistant message block" } // assembled/final
{ "type": "tool_call",      "turn_id": "t_12", "tool_id": "tu_3", "name": "Bash",
                            "input": { "command": "pytest -x" } }
{ "type": "tool_result",    "turn_id": "t_12", "tool_id": "tu_3", "status": "ok",
                            "output": "… 42 passed …" }
{ "type": "approval_request","turn_id": "t_12", "request_id": "ap_1", "tool": "Bash",
                            "input": { "command": "rm -rf build/" }, "explanation": "…" }
{ "type": "status",         "state": "thinking" }   // idle | thinking | awaiting_approval | error
{ "type": "turn_complete",  "turn_id": "t_12", "usage": { "input": 1200, "output": 380 },
                            "cost": null }
{ "type": "error",          "message": "…", "recoverable": true }
```

### Client → server

```jsonc
{ "type": "auth",              "token": "<bearer>" }                 // MUST be first message
{ "type": "user_message",      "text": "add tests for the parser",
                               "attachments": [ { "kind": "image", "media_type": "image/png",
                                                  "data": "<base64>" } ] }   // attachments optional
{ "type": "approval_response", "request_id": "ap_1", "decision": "allow",    // allow | deny | allow_always
                               "note": null }
{ "type": "interrupt" }
```

### Notes
- **No `resize`, no bytes.** This is not a terminal protocol. Text + structured events only.
- `text_delta` gives the live "typing" feel; the assembled `text` is what gets persisted.
- `allow_always` lets the agent's own permission memory (where supported) auto-allow that tool/rule
  going forward.
- Where an agent lacks a concept (e.g. no interactive approvals in a given mode), the adapter simply
  never emits that event — the UI degrades gracefully.

### Example exchange (abridged)

```
client → { auth }
client → { user_message, text: "make GET /health return build sha" }
server → { turn_started, t1 } { status: thinking }
server → { text_delta … } { tool_call: Read app/health.py } { tool_result … }
server → { approval_request: Edit app/health.py }      → status: awaiting_approval
client → { approval_response: allow }
server → { tool_call: Edit … } { tool_result: ok } { text: "Done — returns sha now." }
server → { turn_complete, t1 } { status: idle }
```

---

## Adapter interface (internal)

Each agent is a module implementing one TypeScript interface. Hard-wired (three known agents, no
plugin system).

```typescript
interface AgentAdapter {
  name: "claude" | "codex" | "opencode";

  start(cwd: string, options: AgentOptions): Promise<Session>;
  resume(nativeSessionId: string, cwd: string): Promise<Session>;
  send(session: Session, msg: UserMessage): Promise<void>;          // text + attachments
  events(session: Session): AsyncIterable<NCPEvent>;                // native → normalized
  respondApproval(session: Session, requestId: string,
                  decision: ApprovalDecision): Promise<void>;
  interrupt(session: Session): Promise<void>;
  close(session: Session): Promise<void>;
}
```

`events()` is where each adapter's native vocabulary is mapped to the NCP. The backend owns the
WebSocket, the registry, auth, and persistence; adapters own only translation + the agent process.

---

## Per-agent adapters

### `claude` — Claude Code via the Agent SDK  *(verified)*
- **Driver:** the **Claude Agent SDK for TypeScript** (`@anthropic-ai/claude-agent-sdk`), `query()`
  driven by an **async-generator prompt** = streaming input mode (the recommended persistent,
  interactive mode). Long-lived session, multiple messages, interrupt, image attachments, context
  preserved across turns.
- **Auth:** Claude Pro/Max OAuth (`claude` logged in on the box). No API key.
- **Mapping:**

  | Native (SDK message) | NCP |
  |---|---|
  | `assistant` message → `text` block | `text_delta` / `text` |
  | `assistant` message → `tool_use` block | `tool_call` |
  | `user` message → `tool_result` block | `tool_result` |
  | `canUseTool` callback | `approval_request` (resolve with `approval_response`) |
  | `result` message | `turn_complete` (+ `usage`/`cost`) |
  | session id (init/system message) | `native_session_id` |
  | `interrupt()` | from `interrupt` |
- **Persistence/resume:** SDK persists to `~/.claude/projects/`; resume by session id.
- **Richest adapter** — full structured messages + interactive permissions. Build first.

### `codex` — Codex CLI via `exec --json`  *(map at build time)*
- **Driver:** `codex exec --json [--resume <session_id>] "<prompt>"`. Emits newline-delimited JSON
  events (one per state change) → map to NCP. `exec` spawns per invocation; carry the session id
  across turns for continuity.
- **Auth:** ChatGPT Plus/Pro OAuth via `codex login` (`~/.codex/auth.json`).
- **Approvals:** Codex's non-interactive approval model differs from Claude's callback (sandbox /
  approval-policy flags). **Verify the exact event schema and approval surface when building**;
  where interactive approval isn't available, run under a configured policy and don't emit
  `approval_request`.

### `opencode` — opencode server (`opencode serve`)  *(verified)*
- **Driver:** run `opencode serve`; drive it with the official **`@opencode-ai/sdk`** (TS) —
  `createOpencodeClient({ baseUrl })`. Full-stack TypeScript means we use its typed client directly
  (a win over raw HTTP — type-safe sessions, prompts, events, and permission responses).
- **Mapping:**

  | Native (opencode server) | NCP |
  |---|---|
  | `session.create` / `session.prompt` (text parts) | create / from `user_message` |
  | `event.subscribe()` SSE (`for await … events.stream`) | `text_delta` / `tool_call` / `tool_result` |
  | permission request → respond `…/permissions/{id}` | `approval_request` / `approval_response` |
  | `session.list` / `session.get` | list / resume (persistent) |
  | `session.revert` / `unrevert` | future: undo |
- **Auth:** `auth.set` — opencode **Zen / Go** subscription (its own gateway) or API key. Its own
  billing, *not* a Claude proxy.

**Approval fidelity:** `claude` (`canUseTool` callback) and `opencode` (permission request/respond
API) support **full** interactive, mid-turn approvals → `approval_request`. `codex` via `exec` is
**degraded**: approvals are governed by a preset sandbox/approval policy rather than interactive
callbacks (current `exec` limitation) — the conversation runs under a chosen policy shown in the
UI, and the adapter emits `approval_request` only if/when codex exposes it. Re-check when a richer
Codex SDK lands.

> All three stay inside their vendor's rules by driving the **official** interface under the
> agent's **own** login. No cross-tool token proxying.

---

## Backend service

**Node + TypeScript.** A light HTTP/WebSocket service — **Fastify** (or Hono) for REST, **`ws`**
for the WebSocket, **`better-sqlite3`** for the registry. Full-stack TypeScript: the same language
as the frontend and as two of the three agent SDKs (`@anthropic-ai/claude-agent-sdk`,
`@opencode-ai/sdk`), with the **NCP types shared** via a `@trux/protocol` package imported by both
ends. Runs as the isolated `dev` OS user, behind the box's existing TLS / reverse proxy at a path
or subdomain.

### REST endpoints
- `GET    /workspaces` → configured code roots + their git worktrees (candidates for `cwd`).
- `GET    /conversations` → `[{id, agent, cwd, title, status, updated_at}]`.
- `POST   /conversations` `{agent, cwd, title?}` → create (binds agent + working dir).
- `GET    /conversations/{id}` → detail + transcript.
- `PATCH  /conversations/{id}` `{title?, archived?}`.
- `DELETE /conversations/{id}` → archive/delete.
- `POST   /conversations/{id}/interrupt` → cancel running turn (also available over WS).

### WebSocket
- `WS /conversations/{id}/stream` → bidirectional **NCP**. First client frame MUST be
  `{type:"auth", token}`. Then `user_message` / `approval_response` / `interrupt` up; NCP events
  down. Reconnect re-opens the stream; the transcript (REST detail) restores history.

### Registry & persistence
- `ConversationRegistry` in **sqlite** (`better-sqlite3`) at `~/.trux/trux.db`: conversation rows + the normalized
  transcript (turns and events). Restores full history on reload, uniformly across agents.
- Maps each conversation to its adapter's `native_session_id` for resume across backend restarts.

---

## Auth & security

This is a **remote-code-execution surface**: agents run shell, edit files, and drive git in your
repos. The auth boundary *is* an RCE boundary — treat it as non-negotiable from commit one.

- **Bearer token**, one long random secret in `~/.trux/secret` (0600), constant-time compare.
  REST: `Authorization: Bearer …`. WS: token as the **first message** (no secret in URLs/logs;
  simpler than a ticket dance for a single user).
- **TLS only**, via the box's existing edge.
- **Runs as the `dev` user**, never prod — a breach is contained to the dev sandbox, with no prod
  creds / service accounts in reach.
- **Each subscription under its own official login**; no token proxying (ToS).
- Single-user: no account system, just the one secret.

---

## Deployment & operations

**Trux ships logic, not a service.** No SaaS, no central backend, no accounts, no phone-home. The
runtime is a portable package; the (Phase-2) provisioner is a CLI you run with your own creds.
Everything is user-land — your machine or your cloud account, owned and billed by you. The clean
line vs Lovable: Lovable owns a control plane; trux owns a script you run.

### One portable runtime, three placements
The **same artifact** everywhere; only *host* and *access* differ.

| Placement | Host | Reached via | Mode |
|---|---|---|---|
| **Local** | your laptop | `localhost` in the browser | at the desk — zero network surface, nothing leaves the machine |
| **Existing remote** | your current dev box (`dev` user) | Tailscale (recommended) or reverse proxy + bearer | away / phone |
| **Provisioned cloud** | a VM the provisioner stands up in your GCP/AWS | same as remote | reproducible / on-demand |

- **Config-driven (12-factor):** bind host, port, TLS on/off, auth on/off, db path, secret — all
  from env. Local binds `127.0.0.1`, TLS off, auth optional. Remote requires TLS + bearer.
- **One process** serves the API + the built frontend (same origin → same-origin WS, no CORS).
- **State** in `~/.trux/` (sqlite + secret), untouched by redeploys.
- **Process:** `trux start` locally; a systemd `dev`-user unit on a remote box.

### Provisioner (Phase 2 — the bigger work)
- `trux provision --cloud gcp|aws` orchestrates **Terraform + cloud-init** under your creds: create
  VM + networking, install Node + the agent CLIs, clone your repo, start the service.
- **Stateless / tear-down-able** — trux owns the templates, never the infrastructure; your cloud
  account is the only source of truth; teardown leaves nothing behind.
- **The one human step:** agent OAuth logins (`claude` / `codex` / `opencode`) need browser
  approval — a one-time "finish setup" per environment (trivial locally; a guided step on a fresh VM).
- **Credential discipline:** standard cloud auth (GCP ADC / `aws` profiles), least-privilege
  project/service-account, one-command teardown so no paid VM is ever orphaned.

---

## Output verification / preview

The dev loop isn't complete for a web app until you can **see** the result. Two complementary modes.

### Mode B — agent-captured verification  *(cheap; early)*
The agent drives a headless browser (Playwright) against its own dev server, screenshots or
exercises the app, and posts the result **into the chat** as an image `tool_result` — already
carried by the NCP (`tool_call` → `tool_result`, image-capable). Verification without leaving the
conversation, and the chat model's edge over a terminal: inline visual evidence. No new network
surface — it's just a tool the agent runs; trux only has to render the image.

### Mode A — interactive live preview  *(by placement)*
Open the running dev server in a browser and click around — the human visual check.

| Placement | How preview works |
|---|---|
| **Local** | trivial — the browser hits `localhost:<port>` directly; no new code |
| **Remote / cloud** | **Tailscale serve** (first): map the dev port to a private HTTPS tailnet URL — HMR websockets work, nothing leaves your infra |
| **Remote / cloud** | **Integrated preview proxy** (Phase 2): `https://<conversation>.preview.<host>/ → localhost:<port>`, **subdomain-per-conversation** so the app sees itself at root `/` (no broken asset URLs); proxies HTTP **and** HMR websockets |

### Supporting design
- **Per-conversation port registry** — trux tracks "this conversation's dev stack is on port X"
  (the long-reserved "port map," now justified). The agent announces the port (or trux detects it);
  it powers the **"Open preview"** action — `localhost:<port>` locally, the tailnet/proxy URL remotely.
- **Dev-server host config** — Vite & co. reject unknown `Host` headers by default; remote preview
  needs `server.allowedHosts` / `server.host` set. Documented, not rediscovered.
- **UI** — "Open preview" → **new tab** first (robust). Embedded split-view (chat + live app) is a
  fiddly later step (cross-origin iframing + host checks), not v1.

### Fidelity tracks the surface
Rich interactive visual QA is smoothest **local** (or a laptop browser on the remote preview). The
**phone** carries prompting / steering / reading / approving / *light* preview; agent-captured (B)
covers the phone case where pixel-level QA isn't the point.

---

## Frontend

**Web-first, responsive, PWA.** Build it responsive from the start so the phone works *now* in the
browser (home-screen install); a native mobile app (push, native keyboard, share) comes later
against the same contract.

- **Stack:** React + TypeScript + Vite + Zustand — a standard, fast chat-UI stack (separate app,
  no 3D). Imports the shared **`@trux/protocol`** NCP types, so protocol changes are
  compile-checked against the backend.
- **Sidebar (the multiplexer):** all conversations with an agent badge and a status dot
  (idle / thinking / **awaiting you** / error).
- **Conversation view:** the transcript — user prompts, assistant messages (streamed), collapsible
  tool calls/results, and **approval cards** (Allow / Deny / Always) when the agent is blocked.
- **Compose:** a real multiline text box (native editing, paste, later voice/snippets) → sends
  `user_message`. An **Interrupt** control while a turn runs.
- **New conversation:** pick agent (`claude`/`codex`/`opencode`) + `cwd` (from `/workspaces`).
- Output-smoothness on small screens (collapsing tool noise, etc.) matures with the per-agent
  structured events — it's already structured, so this is layout, not parsing.

---

## Subscription & legitimacy constraints

*(verified 2026-06-16; time-sensitive — recheck before relying)*

- The **terminal was never the gate** for subscription use — **auth is**. Agent SDK / `claude -p`
  run on the Claude Pro/Max OAuth login; `codex exec` runs on the ChatGPT subscription; opencode on
  its Zen/Go subscription.
- **Hard ToS line:** driving each agent via **its own official SDK/CLI under its own login** is
  sanctioned. **Extracting an OAuth token into a different tool/proxy** (OCP/Meridian-style, to run
  e.g. opencode on Claude Max) **violates Anthropic's Consumer ToS and was blocked Apr 4 2026.**
  → Trux drives official binaries only; never a cross-tool token proxy.
- **Cost premise in flux:** Anthropic built, then **paused** (was to start Jun 15 2026), a separate
  metered **Agent SDK credit pool** ($20 Pro / $100 Max 5x / $200 Max 20x; stops when spent unless
  pay-as-you-go is enabled). *Today* SDK usage draws from normal subscription limits = effectively
  cost-free, but expect SDK usage may become separately capped.

---

## Scope

**v1 (build first):**
- `claude` adapter (Agent SDK, streaming).
- Create / list conversations bound to a `cwd` (workspace picker).
- Streaming chat: assistant text + tool-call/result rendering + **approvals** + **interrupt**.
- Web responsive UI (PWA install).
- Bearer auth; sqlite persistence + resume.
- Runs **local** (localhost browser) or on a **hand-provisioned remote box** — same package, config
  from env (see [Deployment](#deployment--operations)).
- **Preview (local):** open `localhost:<port>`; render image `tool_result`s so agent-captured
  verification (Playwright screenshots) shows inline (see [Output verification](#output-verification--preview)).

**Next:**
- `codex` adapter (`exec --json`).
- `opencode` adapter (server API).
- **Adopt/resume sessions started elsewhere** (desk `claude` TUI in `~/.claude/projects/`, or
  `session.list` from codex/opencode) — import the native transcript into the normalized store.
  Headline Next feature: it delivers the desk→phone continuity that motivated trux.
- Image attachments; saved prompt snippets; conversation search/archive/rename.
- **Provisioner** (`trux provision --cloud gcp|aws`) — Terraform + cloud-init under your creds:
  stand up a VM, install, clone, start; stateless / tear-down-able. The bigger work; runtime never
  depends on it (see [Deployment](#deployment--operations)).
- **Remote preview** via **Tailscale serve** + the per-conversation **port registry** → an "Open
  preview" action that reaches the box's dev server from the phone/laptop.

**Deferred:**
- **Integrated preview proxy** — subdomain-per-conversation, HMR-websocket-aware; embedded
  split-view (chat + live app).
- Native mobile app + push notifications (agent needs you).
- Voice input; cost/usage dashboards.
- Worktree creation from the UI; multi-root workspaces.

---

## Non-goals

- Not a terminal / tmux / pty relay.
- Not a token-proxy across subscriptions.
- Not a relay / SaaS — direct to your own box only.
- Not multi-user, not a fleet manager — 1–3 concurrent conversations.
- Not an editor — you prompt; the agent edits.

---

## Resolved decisions

1. **Workspace binding (v1).** Conversations bind to **existing** directories only —
   `GET /workspaces` lists configured code roots and their git worktrees. No create-worktree UI in
   v1: each conversation is code-connected to an agent with git / `gh` / skills, so you create a
   worktree by *asking the agent* (it runs the session-workflow skill / `git worktree add`). A
   dedicated create-worktree affordance is deferred.
2. **Approval fidelity.** `claude` and `opencode` = full interactive approvals; `codex` (`exec`) =
   policy/sandbox-governed, degrade gracefully (see [Per-agent adapters](#per-agent-adapters)).
3. **Adopting existing sessions.** v1 handles **trux-created sessions only**. Importing sessions
   started elsewhere (desk `claude` TUI in `~/.claude/projects/`, or `session.list` from
   codex/opencode) into the normalized transcript and resuming them is the **headline Next
   feature** — it directly serves desk→phone continuity.
4. **Transcript store.** **sqlite** at `~/.trux/trux.db`: a `conversations` table + an append-only
   ordered `events` table, plus the `native_session_id` mapping. Single file, queryable
   (list / status / future search), easy to back up.
5. **Stack — full-stack TypeScript.** Backend = Node + Fastify/Hono + `ws` + `better-sqlite3`;
   frontend = React + TS + Vite + Zustand; a shared **`@trux/protocol`** package holds the NCP
   types for both ends. Chosen on the merits: official agent SDKs for Claude + opencode are TS, the
   workload is I/O-bound streaming glue (Node's strength), and one language front-to-back gives
   compile-checked protocol types. **Rust rejected** — no agent SDKs for any of the three, and its
   speed edge is irrelevant to LLM-bound latency.
