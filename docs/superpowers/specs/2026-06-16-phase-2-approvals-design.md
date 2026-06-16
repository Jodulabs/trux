# Phase 2 — Control: approvals + interrupt (Design Spec)

*Companion to [the design spec](../../2026-06-16-trux-design.md) and
[roadmap](../../2026-06-16-trux-roadmap.md). Builds on Phase 1 (Claude chat
end-to-end): adapter → manager → registry → WS/REST → store/components.*

**Status:** approved design (proceeding to implementation per user instruction).

---

## 1. Goal & "done when"

Make it safe to drive real work: Claude **asks permission** before mutating
tools, you answer **Allow / Deny / Always** from the UI, and you can **cancel** a
runaway turn. Status surfaces as `idle | thinking | awaiting_approval | error`.

**Done when:** Claude asks permission, you answer from the UI, and you can cancel
a running turn.

Interrupt was already wired in Phase 1 (Stop button → `interrupt` →
`session.interrupt()` → `q.interrupt()`); Phase 2 verifies it and surfaces the
status states around it. The new work is **approvals**.

---

## 2. Verified facts — Claude Agent SDK `canUseTool`

*(read from the installed `@anthropic-ai/claude-agent-sdk@0.3.178` types, 2026-06-16)*

```ts
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal
    suggestions?: PermissionUpdate[]   // pass back as updatedPermissions for "always"
    toolUseID: string                  // correlates to the tool_use block id
    title?: string; description?: string; displayName?: string
  },
) => Promise<PermissionResult>

type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean }
```

- `canUseTool` is passed in `query()` options and **awaited by the SDK before a
  tool runs**. Returning a promise lets us park the decision until the user
  answers. Requires `permissionMode: 'default'` (with `'bypassPermissions'` the
  callback never fires).
- `options.toolUseID` equals the `tool_use` block id, so `approval_request.request_id`
  can be correlated with the rendered `tool_call`.
- `options.suggestions` is the session permission-memory payload for
  **allow_always** (returned as `updatedPermissions`).
- `options.signal` aborts on interrupt — we resolve a parked approval as `deny`
  on abort so nothing hangs.

These are time-sensitive; re-check before relying.

---

## 3. Protocol — no changes

The NCP already carries everything:
- `ApprovalRequestEvent { type:'approval_request', turn_id, request_id, tool, input, explanation? }` (server→client)
- `ApprovalResponseMessage { type:'approval_response', request_id, decision, note? }` with
  `decision: 'allow' | 'deny' | 'allow_always'` (client→server), already validated by `parseClientMessage`.
- `ConversationStatus` already includes `'awaiting_approval'`.

No new events. Phase 2 wires the existing contract end to end.

---

## 4. Adapter — the canUseTool bridge

The crux: `query()` messages and the `canUseTool` callback are **two sources**
that must merge into the adapter's single `events()` stream. Phase 1's
`ClaudeSession.events()` iterated `query()` directly; Phase 2 restructures it
around an **outbox `PushQueue<AdapterEvent>`**:

- A background **consume loop** iterates `query()` and pushes mapped events
  (`text_delta`/`text`/`tool_call`/`tool_result`/`turn_complete`) to the outbox.
- The **`canUseTool` callback** pushes an `approval_request` event to the same
  outbox, stores `{ resolve, input, suggestions }` in a `pending` map keyed by
  `toolUseID`, and returns the promise the SDK awaits. On `signal` abort it
  resolves `deny` to unblock.
- `events()` returns `outbox.iterable()` — one long-lived stream the manager
  drains (unchanged manager contract).
- `respondApproval(requestId, decision, note)` resolves the parked promise:
  - `allow` → `{ behavior:'allow', updatedInput: input }`
  - `allow_always` → `{ behavior:'allow', updatedInput: input, updatedPermissions: suggestions }`
  - `deny` → `{ behavior:'deny', message: note ?? 'Denied by user' }`
- `close()` calls `q.close()` and `outbox.end()`.

### Interface deltas (`adapter/types.ts`)

```ts
export type AdapterEvent =
  | ... // Phase 1 variants
  | { type: 'approval_request'; request_id: string; tool: string; input: unknown; explanation?: string }

export interface AgentSession {
  ... // Phase 1 methods
  respondApproval(requestId: string, decision: ApprovalDecision, note?: string | null): void
}
```

`permissionMode` changes `'bypassPermissions'` → `'default'`, so reads stream
freely while mutations (Bash/Edit/Write) route through `canUseTool`.

### Testability

`query` is still injected. The fake `query` captures `options.canUseTool`; tests
invoke it to assert an `approval_request` is emitted, then call `respondApproval`
and assert the returned `PermissionResult` shape per decision.

---

## 5. Manager — approval lifecycle

- `stampTurn` gains an `approval_request` case → wire `ApprovalRequestEvent`.
- The pump, after emitting an `approval_request`, emits `status: awaiting_approval`.
- New `handleApprovalResponse(convId, requestId, decision, note)` →
  `session.respondApproval(...)` then emits `status: thinking` (the turn resumes;
  `turn_complete` later flips to `idle`; a thrown error → `error`).
- Persistence rule is unchanged: `approval_request` and `status` persist (only
  `text_delta` is broadcast-only), so a reload mid-approval replays the pending card.

---

## 6. Stream — route approval_response

Replace the Phase-1 branch that rejected `approval_response` ("not supported in
phase 1") with `manager.handleApprovalResponse(id, msg.request_id, msg.decision, msg.note)`.
`user_message` and `interrupt` routing is unchanged.

---

## 7. Frontend

- **`truxClient.ts`** — add `respondApproval(requestId, decision, note=null)` →
  sends `{ type:'approval_response', request_id, decision, note }`.
- **`store.ts`** — `foldEvent` folds `approval_request` into the transcript as an
  item; new `approvalDecisions: Record<string, ApprovalDecision>` plus
  `recordApproval(requestId, decision)`. `status: awaiting_approval` flows through
  the existing status handling.
- **`components/ApprovalCard.tsx`** — renders the tool + input and **Allow /
  Deny / Always** buttons when undecided; once decided, shows the chosen action
  (buttons disabled). Calls an `onRespond(requestId, decision)` prop.
- **`Transcript.tsx`** — renders an `approval_request` item as `<ApprovalCard>`.
- **`ConversationView.tsx`** — passes `onRespond` that calls
  `client.respondApproval(...)` and `recordApproval(...)`; shows a status line
  (`idle / thinking / awaiting your approval / error`). The Stop (interrupt)
  control shows while `thinking` **or** `awaiting_approval`.

---

## 8. Testing strategy

| Unit | How |
|---|---|
| `adapter/claude` approvals | fake `query` exposes `canUseTool`; assert `approval_request` emitted + `PermissionResult` per decision (allow/deny/allow_always) + abort→deny. |
| `manager` | fake adapter emits `approval_request`; assert `awaiting_approval` persisted+broadcast, `handleApprovalResponse` calls `respondApproval` + emits `thinking`. |
| stream/routes integration | fake adapter that parks on `approval_request` and continues on `respondApproval`; full WS round-trip: card → `approval_response` → completion. |
| frontend store | `foldEvent(approval_request)`, `recordApproval`. |
| frontend `ApprovalCard` | renders buttons, calls `onRespond`; shows decided state. |

Live verification (manual, Task last): prompt Claude to edit/run something, get
a card, Allow/Deny/Always, and interrupt a long turn.

---

## 9. Explicitly deferred

- Editing tool input before allowing (`updatedInput` always passes input through).
- Per-tool persistent allow rules beyond the SDK's session memory.
- Cross-conversation approval notifications (the open conversation shows the card;
  the sidebar shows `awaiting_approval` via the persisted status mirror).

---

## 10. Module boundaries

The adapter still owns only native↔NCP translation + the agent process (now incl.
the permission callback); the manager owns turn/approval lifecycle and
persistence ordering; stream/routes own transport; the store/components own
rendering. The seam added — `respondApproval` on `AgentSession` and the
`approval_request` `AdapterEvent` — is the design's `respondApproval` made
concrete, ready for opencode's permission API at Phase 4.
