# Phase 4a — Agent factory + picker (Design Spec)

*First increment of roadmap Phase 4 (More agents). Companion to
[design](../../2026-06-16-trux-design.md) §Adapter interface and
[roadmap](../../2026-06-16-trux-roadmap.md). Builds on Phases 0–3.*

**Status:** approved design (proceeding per user instruction).

---

## 1. Goal

Make the agent a real parameter end to end: the backend selects an
`AgentAdapter` per conversation by its `agent` field, exposes which agents are
available, and the new-conversation UI offers a picker. No external adapters yet
— this is the **seam** that lets opencode (4b) and codex (4c) slot in by
registering one map entry each.

**Done when:** the picker lists every agent the backend has an adapter for
(today: `claude`), creating a conversation with a listed agent works, and an
unlisted agent is rejected. (Multi-agent "drive any of the three" completes in
4b/4c.)

---

## 2. The change

Today `index.ts` hardcodes `new ConversationManager(registry, new ClaudeAdapter())`
and `routes.ts` rejects any `agent !== 'claude'`. Phase 4a replaces the single
adapter with a **map keyed by agent name**.

### Backend
- `ConversationManager` constructor takes `adapters: Map<AgentName, AgentAdapter>`
  instead of one adapter. `ensureSession` looks up `adapters.get(conv.agent)`;
  if absent it returns null and `handleUserMessage` emits a non-recoverable
  `error` ("no adapter for agent X") instead of crashing.
- New `manager.availableAgents(): AgentName[]` → `[...adapters.keys()]`.
- `index.ts` builds `new Map([['claude', new ClaudeAdapter()]])`.
- `routes.ts`: new `GET /agents` → `{ agents: AgentName[] }`; the `POST
  /conversations` guard accepts any agent in the available set (passed in) rather
  than the literal `'claude'`.

### Protocol
- Add `AgentsResponse { agents: AgentName[] }` to `rest.ts`.

### Frontend
- `api.listAgents()` → `GET /agents`.
- `NewConversationDialog` fetches agents, renders an agent `<select>` (default
  first), and passes the chosen agent to `createConversation`. The button label
  becomes "New conversation". When only `claude` is available the picker shows
  one option — honest, and it grows automatically as adapters land.

---

## 3. Boundaries & testing

The adapter interface, manager turn lifecycle, registry, and stream are
unchanged except for the adapter lookup. Tests:

| Unit | How |
|---|---|
| manager | a 2-entry fake map; a conversation with a registered agent runs; one with an unregistered agent emits an `error` and starts no session; `availableAgents` lists keys. |
| routes | `GET /agents` returns the configured list; `POST` with an available agent succeeds; an unavailable agent → 400. |
| frontend api/dialog | picker renders the fetched agents; create sends the selected agent. |

Existing manager/routes tests update from `new ConversationManager(registry,
adapter)` to `new ConversationManager(registry, new Map([['claude', adapter]]))`.

---

## 4. Deferred to 4b/4c

The opencode and codex adapters themselves (each just registers a map entry +
implements `AgentAdapter`). No roadmap Phase 4 box is ticked until a second agent
actually drives a turn (4b).
