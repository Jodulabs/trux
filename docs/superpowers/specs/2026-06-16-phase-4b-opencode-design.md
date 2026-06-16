# Phase 4b — opencode adapter (Design Spec)

*Second increment of roadmap Phase 4. Builds on 4a (agent factory + picker).
Companion to [design](../../2026-06-16-trux-design.md) §Per-agent adapters.*

**Status:** approved design (proceeding per user instruction).

---

## 1. Goal

Drive an `opencode` conversation through the same trux UI as `claude`: streaming
text, tool calls/results, **interactive approvals**, and interrupt — by
implementing `AgentAdapter` over the official `@opencode-ai/sdk`.

**Done when:** picking `opencode` in the new-conversation dialog and prompting it
streams a real response with tool calls and an approval card you can answer.

---

## 2. Verified facts — `@opencode-ai/sdk@1.17.7`

*(read from the installed SDK `.d.ts`, 2026-06-16. opencode 1.17.7 is installed
and authed on this box.)*

- **Server + client:** `createOpencode(opts?) → { client, server: { url, close() } }`
  spawns a local server and returns a connected `OpencodeClient`. It reads the
  user's opencode auth (Zen/Go) from `~/.local/share/opencode`.
- **`directory` is a per-request query param** (`query.directory`) on
  create/prompt/permission/abort — so **one shared server serves every cwd**; no
  per-directory clients.
- **Session:** `client.session.create({ query:{directory}, body:{} }) → { data: Session }`
  where `Session.id` is the native id (our `native_session_id`).
  `client.session.promptAsync({ path:{id}, query:{directory}, body:{ parts:[{type:'text', text}] } })`
  fires a turn without blocking; events arrive via the stream.
  `client.session.abort({ path:{id}, query:{directory} })` interrupts.
- **Events (global SSE):** `const sub = await client.event.subscribe(); for await (const e of sub.stream) {…}`
  yields the `Event` union for **all** sessions; each event carries a `sessionID`
  we filter on. Relevant members:
  - `message.part.updated` `{ properties: { part: Part, delta?: string } }`
    - `TextPart { type:'text', text, time?:{end?} }`
    - `ToolPart { type:'tool', callID, tool, state: ToolState }`,
      `ToolState` = pending | running`{input}` | completed`{input,output}` | error`{input,error}`
  - `permission.updated` `{ properties: Permission }`,
    `Permission { id, type, sessionID, title, metadata }`
  - `session.idle` `{ properties: { sessionID } }`
  - `session.error` `{ properties: { sessionID?, error? } }`
- **Permission respond:** `client.postSessionIdPermissionsPermissionId({ path:{id, permissionID}, body:{ response: 'once'|'always'|'reject' } })`.

These are time-sensitive; re-check before relying.

---

## 3. Architecture

opencode is a **server with a global event stream**, unlike Claude's in-process
per-session generator. So the adapter owns shared infrastructure and demultiplexes:

```
OpencodeAdapter (one per backend)
  ├─ lazy: createOpencode() → { client, server }   (spawned once, on first start)
  ├─ one global loop: for await (e of client.event.subscribe().stream) → route(e)
  ├─ sessions: Map<opencodeSessionID, (e: Event) => void>   (demux by sessionID)
  └─ start({cwd, resume}) → OpencodeSession

OpencodeSession (one per trux conversation)
  ├─ outbox: PushQueue<AdapterEvent>
  ├─ init(): ensure server → session.create (or reuse `resume`) → register mapper
  ├─ mapper: OpencodeMapper(sessionID)   (pure event→AdapterEvent[])
  ├─ send(text)        → session.promptAsync(parts:[{text}])
  ├─ interrupt()       → session.abort
  ├─ respondApproval() → postSessionIdPermissionsPermissionId(once|always|reject)
  └─ nativeSessionId() → opencode session id
```

`start()` returns synchronously; `init()` runs async and `send()`/`interrupt()`/
`respondApproval()` await readiness. The mapper is registered **before** the
first prompt, so no events are missed.

For tests, the `createOpencode` factory is **injected** — a fake client drives
synthetic events through the whole path with no real server.

---

## 4. The mapper (the crux)

`OpencodeMapper` is a pure, per-session, stateful translator
`map(event): AdapterEvent[]`. State tracks emitted tool callIDs and finalized
text-part ids to avoid duplicates (opencode re-sends a part on every update).

| opencode event (matching sessionID) | NCP `AdapterEvent` |
|---|---|
| `message.part.updated` · text · `delta` present | `text_delta(delta)` |
| `message.part.updated` · text · `time.end` set | `text(part.text)` — once per part id |
| `message.part.updated` · tool · state `running` | `tool_call(callID, tool, input)` — once |
| `message.part.updated` · tool · state `completed` | `tool_call` if not yet, then `tool_result(callID, 'ok', output)` — once |
| `message.part.updated` · tool · state `error` | `tool_call` if not yet, then `tool_result(callID, 'error', error)` — once |
| `permission.updated` | `approval_request(request_id=id, tool=type, input=metadata, explanation=title)` |
| `session.idle` | `turn_complete(cost: null)` |
| `session.error` | `error(message, recoverable:true)` |
| anything else / other sessionID | `[]` |

Notes:
- Events for a different `sessionID` return `[]` (demux safety even though the
  adapter already routes by id).
- `turn_complete` carries `cost: null` — opencode reports cost on `step-finish`
  parts; wiring usage/cost is deferred (degrade gracefully, per design).
- `text_delta` stays ephemeral (manager never persists it), consistent with Claude.

No protocol or manager changes — opencode reuses the exact `AdapterEvent` /
approval / status machinery built in Phases 1–2.

---

## 5. Permission ↔ approval mapping

| trux `ApprovalDecision` | opencode `response` |
|---|---|
| `allow` | `once` |
| `allow_always` | `always` |
| `deny` | `reject` |

The `note` field has no opencode equivalent and is ignored.

---

## 6. Testing

| Unit | How |
|---|---|
| `OpencodeMapper` | feed synthetic `Event`s → assert exact `AdapterEvent[]` for every row above, incl. dedup (tool re-sends, text finalize-once) and sessionID filtering. |
| `OpencodeAdapter`/`Session` | injected fake `createOpencode` returning a fake client (stub `session.create/promptAsync/abort/permissions`, scripted `event.subscribe().stream`); assert create→register→prompt, events reach `events()`, `respondApproval` maps decisions, `interrupt` calls abort, `nativeSessionId`. |
| registration | `index.ts` map includes `opencode`; `/agents` lists it (covered by existing routes test shape — extend if needed). |

Live verification (manual): pick opencode, prompt it in the trux repo, see
streaming + a tool + an approval card; answer it.

---

## 7. Deferred

- Usage/cost on `turn_complete` (opencode `step-finish` parts).
- `session.revert`/`unrevert` (undo) — future.
- Image/file parts from opencode tool results — text + approvals first.
- Reasoning parts rendering — ignored for now.

---

## 8. Boundaries

The opencode adapter owns only the opencode server + native→NCP translation. The
manager, registry, stream, and frontend are unchanged — opencode appears in the
picker (4a) and flows through the same turn/approval/preview machinery. This is
the design's promise — "one interface, the agent as a parameter" — made real for
a second agent.
