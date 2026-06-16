# Phase 4b — opencode Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Checkbox (`- [ ]`) steps.

**Goal:** Implement `AgentAdapter` for opencode over `@opencode-ai/sdk` so an `opencode` conversation streams text + tool calls + approvals through the existing trux machinery.

**Architecture:** One shared `createOpencode()` server, a single global SSE subscription demultiplexed to per-session mappers. `OpencodeMapper` (pure, stateful) translates opencode events → `AdapterEvent`. The `createOpencode` factory is injected for testing.

**Spec:** `docs/superpowers/specs/2026-06-16-phase-4b-opencode-design.md`.

---

## Task 1: SDK dep + OpencodeMapper (pure)

**Files:** Modify `apps/backend/package.json`; Create `apps/backend/src/adapter/opencode-map.ts`; Test `apps/backend/test/adapter/opencode-map.test.ts`.

- [ ] **Step 1: Add dep + install**

`apps/backend/package.json` dependencies, after `@anthropic-ai/claude-agent-sdk`:

```json
    "@opencode-ai/sdk": "^1.17.7",
```

Run from repo root: `pnpm install`.

- [ ] **Step 2: Write `apps/backend/test/adapter/opencode-map.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { OpencodeMapper, type OcEvent } from '../../src/adapter/opencode-map'

const SID = 's1'
function textPart(over: Record<string, unknown> = {}): OcEvent {
  return { type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', sessionID: SID, text: 'Hello', ...over } } }
}

describe('OpencodeMapper', () => {
  it('maps a text delta then a finalized text', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'message.part.updated', properties: { delta: 'Hel', part: { type: 'text', id: 'p1', sessionID: SID, text: 'Hel' } } })).toEqual([
      { type: 'text_delta', text: 'Hel' },
    ])
    expect(m.map({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', sessionID: SID, text: 'Hello', time: { end: 2 } } } })).toEqual([
      { type: 'text', text: 'Hello' },
    ])
  })

  it('finalizes a text part only once', () => {
    const m = new OpencodeMapper(SID)
    const ev = textPart({ time: { end: 1 } })
    expect(m.map(ev)).toEqual([{ type: 'text', text: 'Hello' }])
    expect(m.map(ev)).toEqual([])
  })

  it('emits tool_call on running then tool_result on completed, once each', () => {
    const m = new OpencodeMapper(SID)
    const running: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c1', tool: 'bash', state: { status: 'running', input: { command: 'ls' } } } } }
    const completed: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c1', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb' } } } }
    expect(m.map(running)).toEqual([{ type: 'tool_call', tool_id: 'c1', name: 'bash', input: { command: 'ls' } }])
    expect(m.map(running)).toEqual([])
    expect(m.map(completed)).toEqual([{ type: 'tool_result', tool_id: 'c1', status: 'ok', output: 'a\nb' }])
    expect(m.map(completed)).toEqual([])
  })

  it('emits tool_call+tool_result for a tool that goes straight to completed', () => {
    const m = new OpencodeMapper(SID)
    const completed: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c2', tool: 'read', state: { status: 'completed', input: { path: 'x' }, output: 'ok' } } } }
    expect(m.map(completed)).toEqual([
      { type: 'tool_call', tool_id: 'c2', name: 'read', input: { path: 'x' } },
      { type: 'tool_result', tool_id: 'c2', status: 'ok', output: 'ok' },
    ])
  })

  it('maps an errored tool to a tool_result with status error', () => {
    const m = new OpencodeMapper(SID)
    const errored: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c3', tool: 'bash', state: { status: 'error', input: {}, error: 'boom' } } } }
    expect(m.map(errored)).toEqual([
      { type: 'tool_call', tool_id: 'c3', name: 'bash', input: {} },
      { type: 'tool_result', tool_id: 'c3', status: 'error', output: 'boom' },
    ])
  })

  it('maps a permission to an approval_request', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'permission.updated', properties: { id: 'perm1', type: 'bash', sessionID: SID, title: 'Run ls', metadata: { command: 'ls' } } })).toEqual([
      { type: 'approval_request', request_id: 'perm1', tool: 'bash', input: { command: 'ls' }, explanation: 'Run ls' },
    ])
  })

  it('maps session.idle to turn_complete and session.error to error', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'session.idle', properties: { sessionID: SID } })).toEqual([{ type: 'turn_complete', cost: null }])
    expect(m.map({ type: 'session.error', properties: { sessionID: SID, error: { message: 'nope' } } })).toEqual([
      { type: 'error', message: 'nope', recoverable: true },
    ])
  })

  it('ignores events for a different session', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'message.part.updated', properties: { delta: 'x', part: { type: 'text', id: 'p', sessionID: 'other', text: 'x' } } })).toEqual([])
    expect(m.map({ type: 'session.idle', properties: { sessionID: 'other' } })).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @trux/backend test opencode-map`
Expected: FAIL — module missing.

- [ ] **Step 4: Create `apps/backend/src/adapter/opencode-map.ts`**

```ts
import type { AdapterEvent } from './types'

// Loosely-typed view of the opencode SSE events we read (the SDK Event union is
// huge; we narrow defensively at this untrusted boundary, like the Claude adapter).
export interface OcEvent {
  type: string
  properties?: Record<string, unknown>
}

interface OcTextPart {
  type: 'text'
  id: string
  sessionID: string
  text?: string
  time?: { end?: number }
}
interface OcToolPart {
  type: 'tool'
  id: string
  sessionID: string
  callID: string
  tool: string
  state: {
    status: 'pending' | 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    output?: string
    error?: string
  }
}

function errorMessage(error: unknown): string {
  if (!error) return 'session error'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return JSON.stringify(error)
}

// Pure, per-session, stateful translator: opencode Event → NCP AdapterEvents.
// State dedups opencode's repeated part updates (tool re-sends, text finalize).
export class OpencodeMapper {
  private readonly toolCalled = new Set<string>()
  private readonly toolResulted = new Set<string>()
  private readonly textFinalized = new Set<string>()

  constructor(private readonly sessionId: string) {}

  map(event: OcEvent): AdapterEvent[] {
    const props = (event.properties ?? {}) as Record<string, unknown>
    switch (event.type) {
      case 'message.part.updated': {
        const part = props.part as (OcTextPart | OcToolPart | { type: string; sessionID?: string }) | undefined
        if (!part || part.sessionID !== this.sessionId) return []
        if (part.type === 'text') return this.mapText(part as OcTextPart, props.delta)
        if (part.type === 'tool') return this.mapTool(part as OcToolPart)
        return []
      }
      case 'permission.updated': {
        if (props.sessionID !== this.sessionId) return []
        return [
          {
            type: 'approval_request',
            request_id: String(props.id ?? ''),
            tool: String(props.type ?? ''),
            input: (props.metadata as Record<string, unknown>) ?? {},
            explanation: typeof props.title === 'string' ? props.title : undefined,
          },
        ]
      }
      case 'session.idle': {
        if (props.sessionID !== this.sessionId) return []
        return [{ type: 'turn_complete', cost: null }]
      }
      case 'session.error': {
        if (props.sessionID != null && props.sessionID !== this.sessionId) return []
        return [{ type: 'error', message: errorMessage(props.error), recoverable: true }]
      }
      default:
        return []
    }
  }

  private mapText(part: OcTextPart, delta: unknown): AdapterEvent[] {
    const out: AdapterEvent[] = []
    if (typeof delta === 'string' && delta.length > 0) out.push({ type: 'text_delta', text: delta })
    if (part.time?.end != null && !this.textFinalized.has(part.id)) {
      this.textFinalized.add(part.id)
      out.push({ type: 'text', text: part.text ?? '' })
    }
    return out
  }

  private mapTool(part: OcToolPart): AdapterEvent[] {
    const out: AdapterEvent[] = []
    const { callID, tool, state } = part
    const emitCall = (): void => {
      if (!this.toolCalled.has(callID)) {
        this.toolCalled.add(callID)
        out.push({ type: 'tool_call', tool_id: callID, name: tool, input: state.input ?? {} })
      }
    }
    if (state.status === 'running') {
      emitCall()
    } else if (state.status === 'completed') {
      emitCall()
      if (!this.toolResulted.has(callID)) {
        this.toolResulted.add(callID)
        out.push({ type: 'tool_result', tool_id: callID, status: 'ok', output: state.output ?? '' })
      }
    } else if (state.status === 'error') {
      emitCall()
      if (!this.toolResulted.has(callID)) {
        this.toolResulted.add(callID)
        out.push({ type: 'tool_result', tool_id: callID, status: 'error', output: state.error ?? '' })
      }
    }
    return out
  }
}
```

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @trux/backend test opencode-map && pnpm --filter @trux/backend typecheck`

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/package.json pnpm-lock.yaml pnpm-workspace.yaml apps/backend/src/adapter/opencode-map.ts apps/backend/test/adapter/opencode-map.test.ts
git commit -m "feat(backend): opencode event→NCP mapper + add @opencode-ai/sdk"
```

---

## Task 2: OpencodeAdapter + Session

**Files:** Create `apps/backend/src/adapter/opencode.ts`; Test `apps/backend/test/adapter/opencode.test.ts`.

- [ ] **Step 1: Write `apps/backend/test/adapter/opencode.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { OpencodeAdapter, type OcClient } from '../../src/adapter/opencode'
import type { OcEvent } from '../../src/adapter/opencode-map'
import type { AdapterEvent } from '../../src/adapter/types'
import { PushQueue } from '../../src/adapter/queue'

// A fake opencode client with a controllable event stream and recorded calls.
function fakeClient() {
  const stream = new PushQueue<OcEvent>()
  const calls = { prompts: [] as string[], aborts: 0, permissions: [] as string[], createdDir: '' }
  const client: OcClient = {
    session: {
      create: async ({ query }) => {
        calls.createdDir = query.directory
        return { data: { id: 's1' } }
      },
      promptAsync: async ({ body }) => {
        calls.prompts.push(body.parts[0]?.text ?? '')
      },
      abort: async () => {
        calls.aborts += 1
      },
    },
    postSessionIdPermissionsPermissionId: async ({ body }) => {
      calls.permissions.push(body.response)
    },
    event: {
      subscribe: async () => ({ stream: stream.iterable() }),
    },
  }
  return { client, stream, calls }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('OpencodeAdapter', () => {
  it('creates a session in the cwd, prompts, and streams mapped events', async () => {
    const { client, stream, calls } = fakeClient()
    const adapter = new OpencodeAdapter(async () => ({ client, server: { close() {} } }))
    const session = adapter.start({ cwd: '/repo' })
    session.send('hello')
    await tick()
    expect(calls.createdDir).toBe('/repo')
    expect(calls.prompts).toEqual(['hello'])
    expect(session.nativeSessionId()).toBe('s1')

    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'turn_complete') break
      }
    })()
    stream.push({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p', sessionID: 's1', text: 'hi', time: { end: 1 } } } })
    stream.push({ type: 'session.idle', properties: { sessionID: 's1' } })
    await pump
    expect(got).toEqual([{ type: 'text', text: 'hi' }, { type: 'turn_complete', cost: null }])
  })

  it('routes approvals and maps decisions to opencode responses', async () => {
    const { client, stream, calls } = fakeClient()
    const adapter = new OpencodeAdapter(async () => ({ client, server: { close() {} } }))
    const session = adapter.start({ cwd: '/repo' })
    session.send('go')
    await tick()
    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'approval_request') break
      }
    })()
    stream.push({ type: 'permission.updated', properties: { id: 'perm1', type: 'bash', sessionID: 's1', title: 'Run', metadata: {} } })
    await pump
    expect(got.at(-1)).toEqual({ type: 'approval_request', request_id: 'perm1', tool: 'bash', input: {}, explanation: 'Run' })

    session.respondApproval('perm1', 'allow_always')
    await tick()
    expect(calls.permissions).toEqual(['always'])
  })

  it('interrupt calls session.abort', async () => {
    const { client, calls } = fakeClient()
    const adapter = new OpencodeAdapter(async () => ({ client, server: { close() {} } }))
    const session = adapter.start({ cwd: '/repo' })
    session.send('x')
    await tick()
    await session.interrupt()
    expect(calls.aborts).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trux/backend test adapter/opencode`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `apps/backend/src/adapter/opencode.ts`**

```ts
import { createOpencode } from '@opencode-ai/sdk'
import type { ApprovalDecision } from '@trux/protocol'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'
import { OpencodeMapper, type OcEvent } from './opencode-map'

// The minimal opencode client surface trux uses. The real SDK client is cast to
// this at the boundary; the test injects a fake implementing it directly.
export interface OcClient {
  session: {
    create(o: { query: { directory: string }; body: Record<string, never> }): Promise<{ data?: { id?: string } }>
    promptAsync(o: { path: { id: string }; query: { directory: string }; body: { parts: { type: 'text'; text: string }[] } }): Promise<unknown>
    abort(o: { path: { id: string }; query: { directory: string } }): Promise<unknown>
  }
  postSessionIdPermissionsPermissionId(o: {
    path: { id: string; permissionID: string }
    query: { directory: string }
    body: { response: 'once' | 'always' | 'reject' }
  }): Promise<unknown>
  event: { subscribe(): Promise<{ stream: AsyncIterable<OcEvent> }> }
}

type CreateServer = () => Promise<{ client: OcClient; server: { close(): void } }>

const RESPONSE: Record<ApprovalDecision, 'once' | 'always' | 'reject'> = {
  allow: 'once',
  allow_always: 'always',
  deny: 'reject',
}

const defaultCreateServer: CreateServer = async () => {
  const { client, server } = await createOpencode()
  return { client: client as unknown as OcClient, server }
}

export class OpencodeAdapter implements AgentAdapter {
  readonly name = 'opencode' as const
  private serverP: Promise<{ client: OcClient }> | null = null
  private readonly routes = new Map<string, (e: OcEvent) => void>()

  constructor(private readonly createServer: CreateServer = defaultCreateServer) {}

  // Spawn the shared server once and start the global event demux loop.
  ensureServer(): Promise<{ client: OcClient }> {
    if (!this.serverP) {
      this.serverP = this.createServer().then(({ client }) => {
        void this.consume(client)
        return { client }
      })
    }
    return this.serverP
  }

  private async consume(client: OcClient): Promise<void> {
    const sub = await client.event.subscribe()
    for await (const e of sub.stream) {
      // Broadcast to every live session; each mapper filters by its sessionID.
      for (const route of this.routes.values()) route(e)
    }
  }

  register(sessionId: string, route: (e: OcEvent) => void): void {
    this.routes.set(sessionId, route)
  }
  unregister(sessionId: string): void {
    this.routes.delete(sessionId)
  }

  start({ cwd, resume }: { cwd: string; resume?: string }): AgentSession {
    return new OpencodeSession(this, cwd, resume)
  }
}

class OpencodeSession implements AgentSession {
  private readonly outbox = new PushQueue<AdapterEvent>()
  private readonly ready: Promise<void>
  private client: OcClient | null = null
  private ocId: string | null = null

  constructor(
    private readonly adapter: OpencodeAdapter,
    private readonly cwd: string,
    private readonly resume?: string,
  ) {
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    const { client } = await this.adapter.ensureServer()
    this.client = client
    if (this.resume) {
      this.ocId = this.resume
    } else {
      const res = await client.session.create({ query: { directory: this.cwd }, body: {} })
      this.ocId = res.data?.id ?? null
    }
    if (!this.ocId) {
      this.outbox.push({ type: 'error', message: 'opencode session create failed', recoverable: false })
      this.outbox.end()
      return
    }
    const mapper = new OpencodeMapper(this.ocId)
    this.adapter.register(this.ocId, (e) => {
      for (const ev of mapper.map(e)) this.outbox.push(ev)
    })
  }

  send(text: string): void {
    void this.ready
      .then(() => {
        if (!this.client || !this.ocId) return
        return this.client.session.promptAsync({
          path: { id: this.ocId },
          query: { directory: this.cwd },
          body: { parts: [{ type: 'text', text }] },
        })
      })
      .catch((err: unknown) => this.outbox.push({ type: 'error', message: String(err), recoverable: true }))
  }

  events(): AsyncIterable<AdapterEvent> {
    return this.outbox.iterable()
  }

  async interrupt(): Promise<void> {
    await this.ready
    if (this.client && this.ocId) {
      await this.client.session.abort({ path: { id: this.ocId }, query: { directory: this.cwd } })
    }
  }

  respondApproval(requestId: string, decision: ApprovalDecision): void {
    void this.ready.then(() => {
      if (!this.client || !this.ocId) return
      return this.client.postSessionIdPermissionsPermissionId({
        path: { id: this.ocId, permissionID: requestId },
        query: { directory: this.cwd },
        body: { response: RESPONSE[decision] },
      })
    })
  }

  nativeSessionId(): string | null {
    return this.ocId
  }

  async close(): Promise<void> {
    if (this.ocId) this.adapter.unregister(this.ocId)
    this.outbox.end()
  }
}
```

- [ ] **Step 4: Run + typecheck + commit**

Run: `pnpm --filter @trux/backend test adapter/opencode && pnpm --filter @trux/backend typecheck`

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/adapter/opencode.ts apps/backend/test/adapter/opencode.test.ts
git commit -m "feat(backend): OpencodeAdapter over @opencode-ai/sdk"
```

---

## Task 3: Register opencode

**Files:** Modify `apps/backend/src/index.ts`; Modify `apps/backend/test/routes.test.ts` (extend agents test is optional — keep claude-only fake).

- [ ] **Step 1: Update `apps/backend/src/index.ts`**

Add the import and the map entry:

```ts
import { ClaudeAdapter } from './adapter/claude'
import { OpencodeAdapter } from './adapter/opencode'
```

```ts
  const manager = new ConversationManager(
    registry,
    new Map([
      ['claude', new ClaudeAdapter()],
      ['opencode', new OpencodeAdapter()],
    ]),
  )
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @trux/backend typecheck`

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/index.ts
git commit -m "feat(backend): register opencode adapter"
```

---

## Task 4: Verify + roadmap

- [ ] **Step 1: Whole-workspace typecheck + test**

```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm -r typecheck && pnpm -r test
```
Expected: all green.

- [ ] **Step 2: Manual live run**

```bash
TRUX_WORKSPACES="$HOME/dreamLand/jodulabs/trux" pnpm dev
```
Pick **opencode** in the new-conversation dialog, prompt it in the trux repo, and
confirm: streaming text, a tool call/result, and (for a mutation) an approval
card you can answer. Interrupt a long turn.

- [ ] **Step 3: Roadmap**

In `docs/2026-06-16-trux-roadmap.md` Phase 4, tick `opencode adapter` and
`Agent picker` (delivered in 4a, now meaningful with two agents). Leave the codex
item and the "Done when" for 4c. Annotate opencode as verified once the live run
passes.

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add docs/2026-06-16-trux-roadmap.md
git commit -m "docs(roadmap): opencode adapter + agent picker"
```

---

## Self-Review

**Coverage:** spec §2 SDK facts → Tasks 1–2 (directory query, promptAsync, subscribe stream, permission respond); §3 architecture (shared server, demux, async init) → Task 2; §4 mapper table → Task 1 tests (every row + dedup + filtering); §5 decision→response → Task 2 (`RESPONSE`). **Types:** `OcEvent`, `OpencodeMapper.map`, `OcClient`, `OpencodeAdapter(createServer?)`, `register/unregister/ensureServer`, `RESPONSE` consistent across tasks. **No protocol/manager/frontend changes** — opencode reuses the Phase 1–2 `AdapterEvent`/approval/status path and the 4a picker. **No placeholders.**

**Risk note:** the pure mapper is exhaustively unit-tested; the adapter plumbing is tested with an injected fake client. The real-server path (auth, exact event timing) is validated in the manual live run (Task 4) — the same "needs a real login" boundary as Claude.
