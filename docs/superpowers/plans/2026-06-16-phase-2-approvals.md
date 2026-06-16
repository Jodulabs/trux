# Phase 2 — Approvals + Interrupt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Gate mutating tools behind interactive approvals — Claude asks, you answer Allow/Deny/Always from the UI, status surfaces `awaiting_approval`, and you can interrupt a running turn.

**Architecture:** The Agent SDK's `canUseTool` callback is bridged through the adapter: it emits an `approval_request` and parks a promise keyed by `toolUseID`, resolved by `respondApproval` when the `approval_response` arrives. `ClaudeSession` is restructured around an outbox `PushQueue` so the `query()` message loop and the `canUseTool` callback feed one event stream. The manager stamps approvals and toggles `awaiting_approval`; the frontend renders an `ApprovalCard`.

**Tech Stack:** unchanged from Phase 1. `@anthropic-ai/claude-agent-sdk@0.3.178` `canUseTool` / `PermissionResult`.

**Spec:** `docs/superpowers/specs/2026-06-16-phase-2-approvals-design.md`. No protocol changes — `ApprovalRequestEvent`, `ApprovalResponseMessage`, and `status: awaiting_approval` already exist.

---

## File Structure

```
apps/backend/src/
  adapter/types.ts   # MODIFY: AdapterEvent += approval_request; AgentSession += respondApproval
  adapter/claude.ts  # MODIFY: outbox PushQueue, canUseTool bridge, permissionMode 'default'
  manager.ts         # MODIFY: stamp approval_request, awaiting_approval status, handleApprovalResponse
  stream.ts          # MODIFY: route approval_response

apps/frontend/src/
  truxClient.ts      # MODIFY: respondApproval()
  store.ts           # MODIFY: foldEvent(approval_request), approvalDecisions, recordApproval
  components/ApprovalCard.tsx  # NEW
  components/Transcript.tsx     # MODIFY: render approval_request as ApprovalCard
  components/ConversationView.tsx  # MODIFY: status line, onRespond, busy incl. awaiting_approval
```

---

## Task 1: Adapter — canUseTool bridge

**Files:**
- Modify: `apps/backend/src/adapter/types.ts`
- Modify: `apps/backend/src/adapter/claude.ts`
- Test: `apps/backend/test/adapter/claude.test.ts`

- [ ] **Step 1: Extend `apps/backend/src/adapter/types.ts`**

Add the import and the two deltas:

```ts
import type { AgentName, ApprovalDecision, ToolResultStatus } from '@trux/protocol'
```

Add to the `AdapterEvent` union:

```ts
  | { type: 'approval_request'; request_id: string; tool: string; input: unknown; explanation?: string }
```

Add to the `AgentSession` interface (after `nativeSessionId`):

```ts
  respondApproval(requestId: string, decision: ApprovalDecision, note?: string | null): void
```

- [ ] **Step 2: Add the failing approval tests to `apps/backend/test/adapter/claude.test.ts`**

Replace the `fakeQuery` helper with one that captures `canUseTool` and can block (so the outbox stays open while we drive approvals manually):

```ts
// Build a fake `query` that yields the given SDK messages, captures the
// canUseTool callback, and (when block) never completes so the outbox stays open.
function fakeQuery(messages: unknown[], block = false) {
  const calls: { interrupted: boolean } = { interrupted: false }
  let canUseTool: ((t: string, i: Record<string, unknown>, o: {
    signal: AbortSignal; toolUseID: string; suggestions?: unknown[]; title?: string
  }) => Promise<unknown>) | undefined
  const fn = ((arg: { options?: { canUseTool?: typeof canUseTool } }) => {
    canUseTool = arg.options?.canUseTool
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m
        if (block) await new Promise(() => {})
      },
      interrupt: async () => {
        calls.interrupted = true
      },
      close: async () => {},
    }
  }) as unknown as ConstructorParameters<typeof ClaudeAdapter>[0]
  return { fn, calls, getCanUseTool: () => canUseTool! }
}
```

Add these tests inside `describe('ClaudeAdapter mapping', ...)`:

```ts
  it('emits an approval_request and resolves allow with the input passed through', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const result = getCanUseTool()('Bash', { command: 'ls' }, {
      signal: new AbortController().signal, toolUseID: 'tu_1', suggestions: [{ x: 1 }], title: 'run ls',
    })
    const it = session.events()[Symbol.asyncIterator]()
    expect((await it.next()).value).toEqual({
      type: 'approval_request', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' }, explanation: 'run ls',
    })
    session.respondApproval('tu_1', 'allow')
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
  })

  it('resolves allow_always with the suggestions as updatedPermissions', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const result = getCanUseTool()('Edit', { path: 'a' }, {
      signal: new AbortController().signal, toolUseID: 'tu_2', suggestions: [{ x: 1 }],
    })
    session.respondApproval('tu_2', 'allow_always')
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { path: 'a' }, updatedPermissions: [{ x: 1 }] })
  })

  it('resolves deny with the note as the message', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const result = getCanUseTool()('Bash', {}, { signal: new AbortController().signal, toolUseID: 'tu_3' })
    session.respondApproval('tu_3', 'deny', 'no thanks')
    expect(await result).toEqual({ behavior: 'deny', message: 'no thanks' })
  })

  it('denies a parked approval when the signal aborts', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const ac = new AbortController()
    const result = getCanUseTool()('Bash', {}, { signal: ac.signal, toolUseID: 'tu_4' })
    ac.abort()
    expect(await result).toEqual({ behavior: 'deny', message: 'interrupted' })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @trux/backend test claude`
Expected: FAIL — `respondApproval` / `approval_request` not implemented.

- [ ] **Step 4: Rewrite `apps/backend/src/adapter/claude.ts`**

```ts
import { query as realQuery } from '@anthropic-ai/claude-agent-sdk'
import type { ApprovalDecision } from '@trux/protocol'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'

type QueryFn = typeof realQuery
type SdkUserMessage = { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }
type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string }
type CanUseToolOptions = {
  signal: AbortSignal
  toolUseID: string
  suggestions?: unknown[]
  title?: string
  description?: string
}
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions,
) => Promise<PermissionResult>
type QueryHandle = AsyncIterable<unknown> & { interrupt(): Promise<void>; close?(): Promise<void> }

interface PendingApproval {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
  suggestions?: unknown[]
}

// Best-effort stringify of a tool_result `content` (string | content-block array | object).
function stringifyToolOutput(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c),
      )
      .join('')
  }
  return content == null ? '' : JSON.stringify(content)
}

class ClaudeSession implements AgentSession {
  private sessionId: string | null = null
  private readonly outbox = new PushQueue<AdapterEvent>()
  private readonly pending = new Map<string, PendingApproval>()
  private readonly q: QueryHandle

  constructor(startQuery: (canUseTool: CanUseTool) => QueryHandle, private readonly inbox: PushQueue<SdkUserMessage>) {
    this.q = startQuery((toolName, input, options) => this.requestApproval(toolName, input, options))
    void this.consume()
  }

  // The canUseTool bridge: surface an approval_request and park the SDK's promise.
  private requestApproval(toolName: string, input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const requestId = options.toolUseID
      this.pending.set(requestId, { resolve, input, suggestions: options.suggestions })
      this.outbox.push({
        type: 'approval_request',
        request_id: requestId,
        tool: toolName,
        input,
        explanation: options.title ?? options.description,
      })
      options.signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) resolve({ behavior: 'deny', message: 'interrupted' })
      })
    })
  }

  // Drain query() for the whole session, mapping native messages onto the outbox.
  private async consume(): Promise<void> {
    try {
      for await (const raw of this.q) {
        const msg = raw as Record<string, unknown>
        if (typeof msg.session_id === 'string') this.sessionId = msg.session_id

        switch (msg.type) {
          case 'stream_event': {
            const ev = msg.stream_event as { type?: string; delta?: { type?: string; text?: string } }
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              this.outbox.push({ type: 'text_delta', text: ev.delta.text ?? '' })
            }
            break
          }
          case 'assistant': {
            const content = (msg.message as { content?: unknown[] })?.content ?? []
            for (const b of content) {
              const block = b as Record<string, unknown>
              if (block.type === 'text') {
                this.outbox.push({ type: 'text', text: String(block.text ?? '') })
              } else if (block.type === 'tool_use') {
                this.outbox.push({
                  type: 'tool_call',
                  tool_id: String(block.id ?? ''),
                  name: String(block.name ?? ''),
                  input: block.input,
                })
              }
            }
            break
          }
          case 'user': {
            const content = (msg.message as { content?: unknown })?.content
            if (Array.isArray(content)) {
              for (const b of content) {
                const block = b as Record<string, unknown>
                if (block.type === 'tool_result') {
                  this.outbox.push({
                    type: 'tool_result',
                    tool_id: String(block.tool_use_id ?? ''),
                    status: block.is_error ? 'error' : 'ok',
                    output: stringifyToolOutput(block.content),
                  })
                }
              }
            }
            break
          }
          case 'result': {
            const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined
            this.outbox.push({
              type: 'turn_complete',
              usage: { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 },
              cost: (msg.total_cost_usd as number | undefined) ?? null,
            })
            break
          }
        }
      }
    } catch (err) {
      this.outbox.push({ type: 'error', message: String(err), recoverable: true })
    } finally {
      this.outbox.end()
    }
  }

  send(text: string): void {
    this.inbox.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
  }

  events(): AsyncIterable<AdapterEvent> {
    return this.outbox.iterable()
  }

  respondApproval(requestId: string, decision: ApprovalDecision, note?: string | null): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    if (decision === 'deny') {
      entry.resolve({ behavior: 'deny', message: note ?? 'Denied by user' })
    } else if (decision === 'allow_always') {
      entry.resolve({ behavior: 'allow', updatedInput: entry.input, updatedPermissions: entry.suggestions })
    } else {
      entry.resolve({ behavior: 'allow', updatedInput: entry.input })
    }
  }

  async interrupt(): Promise<void> {
    await this.q.interrupt()
  }
  async close(): Promise<void> {
    await this.q.close?.()
    this.outbox.end()
  }
  nativeSessionId(): string | null {
    return this.sessionId
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  constructor(private readonly queryFn: QueryFn = realQuery) {}

  start({ cwd, resume }: { cwd: string; resume?: string }): AgentSession {
    const inbox = new PushQueue<SdkUserMessage>()
    const startQuery = (canUseTool: CanUseTool): QueryHandle =>
      this.queryFn({
        prompt: inbox.iterable() as never,
        options: {
          cwd,
          permissionMode: 'default',
          includePartialMessages: true,
          resume,
          canUseTool: canUseTool as never,
        },
      }) as unknown as QueryHandle
    return new ClaudeSession(startQuery, inbox)
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @trux/backend test claude && pnpm --filter @trux/backend typecheck`
Expected: PASS (3 Phase-1 mapping tests + 4 approval tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/adapter/types.ts apps/backend/src/adapter/claude.ts apps/backend/test/adapter/claude.test.ts
git commit -m "feat(backend): canUseTool approval bridge in ClaudeAdapter"
```

---

## Task 2: Manager — approval lifecycle

**Files:**
- Modify: `apps/backend/src/manager.ts`
- Modify: `apps/backend/test/manager.test.ts`

- [ ] **Step 1: Add the failing approval test to `apps/backend/test/manager.test.ts`**

First, add `respondApproval` to the `FakeSession` class (the `AgentSession` interface now requires it):

```ts
  respondApproval(): void {
    this.respondedWith.push('called')
  }
```

and add `respondedWith: string[] = []` as a field on `FakeSession`.

Then add this test:

```ts
  it('emits awaiting_approval after an approval_request and routes the response', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'approval_request', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } },
    ])
    const manager = new ConversationManager(registry, adapter)
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()

    expect(seen.map((e) => e.type)).toEqual([
      'user_text', 'turn_started', 'status', 'approval_request', 'status',
    ])
    expect((seen.at(-1) as { state: string }).state).toBe('awaiting_approval')
    expect(registry.getConversation(conv.id)?.status).toBe('awaiting_approval')

    await manager.handleApprovalResponse(conv.id, 'tu_1', 'allow', null)
    expect(adapter.last.respondedWith).toEqual(['called'])
    expect(seen.at(-1)).toEqual({ type: 'status', state: 'thinking' })
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trux/backend test manager`
Expected: FAIL — `handleApprovalResponse` undefined / approval_request not stamped.

- [ ] **Step 3: Update `apps/backend/src/manager.ts`**

Add the `approval_request` case to `stampTurn`:

```ts
    case 'approval_request':
      return {
        type: 'approval_request',
        turn_id: turnId,
        request_id: e.request_id,
        tool: e.tool,
        input: e.input,
        explanation: e.explanation,
      }
```

In `pump`, after `this.emit(convId, wire)` and before the `turn_complete` check, add:

```ts
        if (wire.type === 'approval_request') {
          this.emit(convId, { type: 'status', state: 'awaiting_approval' })
        }
```

Add the new public method (next to `interrupt`):

```ts
  async handleApprovalResponse(
    convId: string,
    requestId: string,
    decision: ApprovalDecision,
    note: string | null,
  ): Promise<void> {
    const live = this.live.get(convId)
    if (!live) return
    live.session.respondApproval(requestId, decision, note)
    this.emit(convId, { type: 'status', state: 'thinking' })
  }
```

Add `ApprovalDecision` to the protocol import at the top:

```ts
import type { ApprovalDecision, ServerEvent } from '@trux/protocol'
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @trux/backend test manager`
Expected: PASS (Phase-1 tests + the new approval test).

- [ ] **Step 5: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/manager.ts apps/backend/test/manager.test.ts
git commit -m "feat(backend): manager approval lifecycle + awaiting_approval status"
```

---

## Task 3: Stream — route approval_response

**Files:**
- Modify: `apps/backend/src/stream.ts`
- Modify: `apps/backend/test/routes.test.ts`

- [ ] **Step 1: Update the WS routing in `apps/backend/src/stream.ts`**

Replace the trailing branch:

```ts
        if (msg.type === 'user_message') {
          void manager.handleUserMessage(id, msg.text)
        } else if (msg.type === 'interrupt') {
          void manager.interrupt(id)
        } else if (msg.type === 'approval_response') {
          void manager.handleApprovalResponse(id, msg.request_id, msg.decision, msg.note ?? null)
        }
```

(The previous `else` that sent "not supported in phase 1" is removed — every client message type is now handled.)

- [ ] **Step 2: Add the failing approval round-trip test to `apps/backend/test/routes.test.ts`**

Update the `FakeAdapter` so its session parks on an approval and continues when answered:

```ts
class FakeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  start(): AgentSession {
    const outbox = new PushQueue<AdapterEvent>()
    let answered: ((decision: string) => void) | null = null
    return {
      send: () => {
        outbox.push({ type: 'approval_request', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } })
        // Resume only once the approval is answered.
        void new Promise<string>((r) => (answered = r)).then(() => {
          outbox.push({ type: 'tool_result', tool_id: 'tu_1', status: 'ok', output: 'done' })
          outbox.push({ type: 'turn_complete', cost: 0 })
          outbox.end()
        })
      },
      events: () => outbox.iterable(),
      interrupt: async () => {},
      close: async () => {},
      nativeSessionId: () => 'sess_x',
      respondApproval: (_id, decision) => answered?.(decision),
    }
  }
}
```

Add the test in `describe('WS turn engine', ...)`:

```ts
  it('round-trips an approval: request → response → completion', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const events = await new Promise<ServerEvent[]>((resolve, reject) => {
      const out: ServerEvent[] = []
      const ws = new WebSocket(`ws://127.0.0.1:${port}/conversations/${conv.id}/stream`)
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: '' })))
      ws.on('message', (raw) => {
        const event = JSON.parse(raw.toString()) as ServerEvent
        out.push(event)
        if (event.type === 'hello') ws.send(JSON.stringify({ type: 'user_message', text: 'go' }))
        if (event.type === 'approval_request') {
          ws.send(JSON.stringify({ type: 'approval_response', request_id: 'tu_1', decision: 'allow', note: null }))
        }
        if (event.type === 'status' && event.state === 'idle') {
          ws.close()
          resolve(out)
        }
      })
      ws.on('error', reject)
    })
    expect(events.map((e) => e.type)).toEqual([
      'hello', 'user_text', 'turn_started', 'status', 'approval_request', 'status', 'status', 'tool_result', 'turn_complete', 'status',
    ])
    const states = events.filter((e): e is Extract<ServerEvent, { type: 'status' }> => e.type === 'status').map((e) => e.state)
    expect(states).toEqual(['thinking', 'awaiting_approval', 'thinking', 'idle'])
  })
```

- [ ] **Step 3: Run to verify it passes**

Run: `pnpm --filter @trux/backend test routes`
Expected: PASS (existing REST/WS tests + the approval round-trip).

- [ ] **Step 4: Run the whole backend suite + typecheck**

Run: `pnpm --filter @trux/backend test && pnpm --filter @trux/backend typecheck`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/stream.ts apps/backend/test/routes.test.ts
git commit -m "feat(backend): route approval_response through the WS turn engine"
```

---

## Task 4: Frontend — client + store

**Files:**
- Modify: `apps/frontend/src/truxClient.ts`
- Modify: `apps/frontend/src/store.ts`
- Modify: `apps/frontend/test/store.test.ts`

- [ ] **Step 1: Add `respondApproval` to `apps/frontend/src/truxClient.ts`**

Add to the `TruxClient` interface:

```ts
  respondApproval: (requestId: string, decision: ApprovalDecision, note?: string | null) => void
```

Import the type at the top (add to the existing `@trux/protocol` import):

```ts
import type { ApprovalDecision, ClientMessage, HelloEvent, ServerEvent } from '@trux/protocol'
```

Add to the returned object:

```ts
    respondApproval: (requestId, decision, note = null) =>
      ws.send(JSON.stringify({ type: 'approval_response', request_id: requestId, decision, note })),
```

- [ ] **Step 2: Add the failing store test to `apps/frontend/test/store.test.ts`**

```ts
import { useStore } from '../src/store'

describe('foldEvent approvals', () => {
  it('keeps an approval_request as a transcript item', () => {
    const items = fold([
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } },
    ])
    expect(items).toEqual([
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } },
    ])
  })
})

describe('recordApproval', () => {
  it('records the decision for a request id', () => {
    useStore.getState().recordApproval('tu_1', 'allow')
    expect(useStore.getState().approvalDecisions['tu_1']).toBe('allow')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @trux/frontend test store`
Expected: FAIL — `approval_request` not folded / `recordApproval` undefined.

- [ ] **Step 4: Update `apps/frontend/src/store.ts`**

Add `ApprovalRequestEvent` and `ApprovalDecision` to the protocol import and the `TranscriptItem` union:

```ts
import type {
  ApprovalDecision,
  ApprovalRequestEvent,
  Conversation,
  ServerEvent,
  TextEvent,
  ToolCallEvent,
  ToolResultEvent,
  UserTextEvent,
} from '@trux/protocol'

export type TranscriptItem =
  | UserTextEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
```

Add an `approval_request` case to `foldEvent` (before `default`):

```ts
    case 'approval_request':
      return [...items, event]
```

Add to the `TruxState` interface and the store body:

```ts
  approvalDecisions: Record<string, ApprovalDecision>
  recordApproval: (requestId: string, decision: ApprovalDecision) => void
```

In the `create(...)` initial state add `approvalDecisions: {}` and the action:

```ts
  recordApproval(requestId, decision) {
    set({ approvalDecisions: { ...get().approvalDecisions, [requestId]: decision } })
  },
```

Also reset `approvalDecisions: {}` inside `selectConversation` (alongside the transcript reset) so switching conversations clears decided cards:

```ts
    set({
      currentId: id,
      status: detail.conversation.status,
      approvalDecisions: {},
      transcript: detail.transcript.map((s) => s.event).reduce(foldEvent, [] as TranscriptItem[]),
    })
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @trux/frontend test store && pnpm --filter @trux/frontend typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/frontend/src/truxClient.ts apps/frontend/src/store.ts apps/frontend/test/store.test.ts
git commit -m "feat(frontend): respondApproval client + approval store state"
```

---

## Task 5: Frontend — ApprovalCard + wiring

**Files:**
- Create: `apps/frontend/src/components/ApprovalCard.tsx`
- Modify: `apps/frontend/src/components/Transcript.tsx`
- Modify: `apps/frontend/src/components/ConversationView.tsx`
- Test: `apps/frontend/test/components.test.tsx`

- [ ] **Step 1: Create `apps/frontend/src/components/ApprovalCard.tsx`**

```tsx
import type { ApprovalDecision, ApprovalRequestEvent } from '@trux/protocol'

interface Props {
  event: ApprovalRequestEvent
  decision?: ApprovalDecision
  onRespond: (requestId: string, decision: ApprovalDecision) => void
}

export function ApprovalCard({ event, decision, onRespond }: Props): React.ReactElement {
  return (
    <div className="approval-card" data-testid="approval-card">
      <strong>Approve {event.tool}?</strong>
      {event.explanation ? <p>{event.explanation}</p> : null}
      <pre>{JSON.stringify(event.input, null, 2)}</pre>
      {decision ? (
        <p data-testid="approval-decided">You chose: {decision}</p>
      ) : (
        <div className="approval-actions">
          <button data-testid="approve-allow" onClick={() => onRespond(event.request_id, 'allow')}>Allow</button>
          <button data-testid="approve-deny" onClick={() => onRespond(event.request_id, 'deny')}>Deny</button>
          <button data-testid="approve-always" onClick={() => onRespond(event.request_id, 'allow_always')}>Always</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `apps/frontend/src/components/Transcript.tsx`**

Change the props and render approval items. New file contents:

```tsx
import type { ApprovalDecision } from '@trux/protocol'
import type { TranscriptItem } from '../store'
import { ApprovalCard } from './ApprovalCard'

interface Props {
  items: TranscriptItem[]
  approvalDecisions: Record<string, ApprovalDecision>
  onRespond: (requestId: string, decision: ApprovalDecision) => void
}

export function Transcript({ items, approvalDecisions, onRespond }: Props): React.ReactElement {
  return (
    <div data-testid="transcript">
      {items.map((item, i) => {
        if (item.type === 'user_text') return <p key={i} className="msg user">{item.text}</p>
        if (item.type === 'text') return <p key={i} className="msg assistant">{item.text}</p>
        if (item.type === 'approval_request')
          return (
            <ApprovalCard
              key={i}
              event={item}
              decision={approvalDecisions[item.request_id]}
              onRespond={onRespond}
            />
          )
        if (item.type === 'tool_call')
          return (
            <details key={i} className="tool">
              <summary>🔧 {item.name}</summary>
              <pre>{JSON.stringify(item.input, null, 2)}</pre>
            </details>
          )
        return (
          <details key={i} className={`tool ${item.status}`}>
            <summary>← {item.status}</summary>
            <pre>{item.output}</pre>
          </details>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Update `apps/frontend/src/components/ConversationView.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import type { ApprovalDecision } from '@trux/protocol'
import { connectTrux, type TruxClient } from '../truxClient'
import { useStore } from '../store'
import { Transcript } from './Transcript'
import { Composer } from './Composer'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  awaiting_approval: 'Awaiting your approval',
  error: 'Error',
}

export function ConversationView({ id }: { id: string }): React.ReactElement {
  const transcript = useStore((s) => s.transcript)
  const status = useStore((s) => s.status)
  const applyEvent = useStore((s) => s.applyEvent)
  const approvalDecisions = useStore((s) => s.approvalDecisions)
  const recordApproval = useStore((s) => s.recordApproval)
  const client = useRef<TruxClient | null>(null)

  useEffect(() => {
    const c = connectTrux({
      url: `ws://${location.host}/conversations/${id}/stream`,
      token: localStorage.getItem('trux_token') ?? '',
      onEvent: (event) => applyEvent(event),
    })
    client.current = c
    return () => c.close()
  }, [id, applyEvent])

  const onRespond = (requestId: string, decision: ApprovalDecision): void => {
    client.current?.respondApproval(requestId, decision)
    recordApproval(requestId, decision)
  }

  const busy = status === 'thinking' || status === 'awaiting_approval'

  return (
    <section className="conversation">
      <div data-testid="status-line" className={`status ${status}`}>{STATUS_LABEL[status] ?? status}</div>
      <Transcript items={transcript} approvalDecisions={approvalDecisions} onRespond={onRespond} />
      <Composer
        busy={busy}
        onSend={(text) => client.current?.sendUserMessage(text)}
        onInterrupt={() => client.current?.interrupt()}
      />
    </section>
  )
}
```

- [ ] **Step 4: Add the failing ApprovalCard test to `apps/frontend/test/components.test.tsx`**

Add the import and a describe block:

```tsx
import { ApprovalCard } from '../src/components/ApprovalCard'
import type { ApprovalRequestEvent } from '@trux/protocol'

describe('ApprovalCard', () => {
  const event: ApprovalRequestEvent = {
    type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' },
  }

  it('renders Allow/Deny/Always and calls onRespond', () => {
    const onRespond = vi.fn()
    render(<ApprovalCard event={event} onRespond={onRespond} />)
    fireEvent.click(screen.getByTestId('approve-allow'))
    expect(onRespond).toHaveBeenCalledWith('tu_1', 'allow')
  })

  it('shows the decided state instead of buttons', () => {
    render(<ApprovalCard event={event} decision="deny" onRespond={() => {}} />)
    expect(screen.getByTestId('approval-decided')).toHaveTextContent('deny')
    expect(screen.queryByTestId('approve-allow')).toBeNull()
  })
})
```

The existing `Transcript` test in this file passes `items` only — update that render call to include the new required props:

```tsx
    render(<Transcript items={items} approvalDecisions={{}} onRespond={() => {}} />)
```

- [ ] **Step 5: Run the frontend suite + typecheck + build**

Run:
```bash
pnpm --filter @trux/frontend test
pnpm --filter @trux/frontend typecheck
pnpm --filter @trux/frontend build
```
Expected: all pass; clean build.

- [ ] **Step 6: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/frontend/src/components/ApprovalCard.tsx apps/frontend/src/components/Transcript.tsx \
        apps/frontend/src/components/ConversationView.tsx apps/frontend/test/components.test.tsx
git commit -m "feat(frontend): approval cards + status line + interrupt while awaiting"
```

---

## Task 6: End-to-end verification + roadmap

- [ ] **Step 1: Whole-workspace typecheck + test**

Run:
```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm -r typecheck
pnpm -r test
```
Expected: all three packages typecheck; every suite passes.

- [ ] **Step 2: Manual live run**

```bash
TRUX_WORKSPACES="$HOME/dreamLand/jodulabs/trux" pnpm dev
```
1. Create a claude conversation on the trux repo.
2. Prompt: `create a file /tmp/trux-hello.txt containing "hi"` → expect an **approval card** for the Write/Bash tool; status shows **Awaiting your approval**.
3. Click **Deny** → the tool is refused; click **Allow** on a retry → it proceeds.
4. Start a long task and click **Stop** mid-turn → it interrupts.

- [ ] **Step 3: Tick roadmap Phase 2**

In `docs/2026-06-16-trux-roadmap.md`, change the three Phase 2 `- [ ]` items to `- [x]` and append ` ✓ 2026-06-16` to the "Done when" line.

- [ ] **Step 4: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add docs/2026-06-16-trux-roadmap.md
git commit -m "docs(roadmap): mark Phase 2 complete"
```

---

## Self-Review

**Spec coverage:**
- §2 `canUseTool` contract → Task 1 (bridge, `permissionMode: 'default'`, PermissionResult per decision, abort→deny). ✅
- §3 no protocol changes → confirmed; reuses `ApprovalRequestEvent`/`ApprovalResponseMessage`/`awaiting_approval`. ✅
- §4 adapter outbox restructure + `respondApproval` + `approval_request` AdapterEvent → Task 1. ✅
- §5 manager stamp + `awaiting_approval` + `handleApprovalResponse` → Task 2. ✅
- §6 stream routes `approval_response` → Task 3. ✅
- §7 frontend client/store/ApprovalCard/Transcript/ConversationView → Tasks 4, 5. ✅
- §8 testing (adapter approvals, manager, WS round-trip, store, component) → Tasks 1–5; manual live → Task 6. ✅

**Placeholder scan:** none — all code is complete and copy-able.

**Type consistency:** `AdapterEvent.approval_request`, `AgentSession.respondApproval(requestId, decision, note?)`, `ConversationManager.handleApprovalResponse(convId, requestId, decision, note)`, `TruxClient.respondApproval`, store `approvalDecisions`/`recordApproval`, `ApprovalCard` props, and `Transcript` props (`items`/`approvalDecisions`/`onRespond`) are defined once and referenced identically across tasks. `permissionMode` flips `'bypassPermissions'`→`'default'` in Task 1 only.

**Interrupt:** already functional from Phase 1; Task 5 surfaces it during `awaiting_approval` (busy includes that state) and Task 6 verifies cancel. The roadmap's interrupt item is satisfied without new backend code.
