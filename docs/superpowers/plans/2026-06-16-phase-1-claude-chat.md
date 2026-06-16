# Phase 1 — Claude Chat End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make trux usable with one agent: create a `claude` conversation bound to a `cwd` from a workspace picker, prompt Claude in a real repo, watch streaming text + tool calls/results, interrupt a turn, and have the transcript survive a browser reload.

**Architecture:** The Claude Agent SDK (`query()` streaming-input) is wrapped by a `ClaudeAdapter` that translates native SDK messages into NCP events. A `ConversationManager` owns turn lifecycle (`turn_id` stamping, status) and bridges the WebSocket ↔ adapter ↔ a sqlite `Registry`. Events persist before they broadcast (the transcript is the source of truth); `text_delta` is the one ephemeral, broadcast-only event. The frontend (Zustand store + REST client + components) renders the transcript and reconnects per conversation.

**Tech Stack:** TypeScript 6 (ESM, bundler resolution) · Node 22 · Fastify 5 + @fastify/websocket 11 + ws 8 · better-sqlite3 12 · `@anthropic-ai/claude-agent-sdk` ^0.3.178 · React 19 + Vite 8 + Zustand 5 · Vitest 4 (+ happy-dom, @testing-library/react).

**Spec:** `docs/superpowers/specs/2026-06-16-phase-1-claude-chat-design.md`. This plan refines spec §3: it adds one additive NCP event, `user_text` (the persisted echo of a user prompt), so the transcript is self-contained — the spec said "wire events unchanged," but rendering user prompts on reload requires it.

---

## File Structure

```
packages/protocol/src/
  events.ts        # MODIFY: add UserTextEvent + add to ServerEvent union
  rest.ts          # NEW: REST DTOs (Workspace, Conversation, StoredEvent, requests)
  index.ts         # MODIFY: export * from './rest'

apps/backend/src/
  config.ts        # MODIFY: add workspaceRoots from TRUX_WORKSPACES
  auth.ts          # NEW: tokenMatches + bearer check helpers
  registry.ts      # NEW: SqliteRegistry (conversations + events CRUD, seq, transcript)
  workspaces.ts    # NEW: listWorkspaces + parseWorktrees
  adapter/
    queue.ts       # NEW: PushQueue (async-generator-backed input queue)
    types.ts       # NEW: AgentAdapter, AgentSession, AdapterEvent
    claude.ts      # NEW: ClaudeAdapter over the Agent SDK
  manager.ts       # NEW: ConversationManager (turn lifecycle, persist-before-broadcast)
  stream.ts        # NEW: WS turn engine (replaces Phase 0 "not implemented" branch)
  routes.ts        # NEW: REST routes (conversations CRUD + workspaces)
  server.ts        # MODIFY: buildServer(config, db, manager) wires routes + stream
  index.ts         # MODIFY: construct registry + adapter + manager

apps/frontend/src/
  api.ts           # NEW: typed REST client
  store.ts         # NEW: Zustand store + foldEvent reducer
  truxClient.ts    # MODIFY: add sendUserMessage + interrupt
  App.tsx          # MODIFY: sidebar + conversation view layout
  components/
    Sidebar.tsx              # NEW
    NewConversationDialog.tsx# NEW
    ConversationView.tsx     # NEW
    Transcript.tsx           # NEW
    Composer.tsx             # NEW
```

**Responsibility boundaries:** `protocol` = wire + REST contract only. `adapter/*` = native↔NCP translation + the agent process (no sockets, sqlite, or `turn_id`). `manager` = turn lifecycle + persistence ordering + fan-out (no Claude specifics). `registry` = storage + `seq`. `stream`/`routes` = transport. Frontend `store` = state + pure folding; components only render.

---

## Task 1: Protocol — `user_text` event + REST DTOs

**Files:**
- Modify: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/rest.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/rest.test.ts`

- [ ] **Step 1: Add `UserTextEvent` to `packages/protocol/src/events.ts`**

Add this interface next to the other server events (after `ErrorEvent`):

```ts
// The persisted echo of a user's prompt, so the transcript renders user turns
// on reload. Emitted by the manager when a user_message arrives (additive, like hello).
export interface UserTextEvent {
  type: 'user_text'
  turn_id: string
  text: string
}
```

Add `UserTextEvent` to the `ServerEvent` union:

```ts
export type ServerEvent =
  | HelloEvent
  | UserTextEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | StatusEvent
  | TurnCompleteEvent
  | ErrorEvent
```

- [ ] **Step 2: Create `packages/protocol/src/rest.ts`**

```ts
import type { ConversationStatus, ServerEvent } from './events'

export type AgentName = 'claude' | 'codex' | 'opencode'

export interface Worktree {
  path: string
  branch: string | null
}
export interface Workspace {
  root: string
  worktrees: Worktree[]
}

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

// One persisted transcript row: a server event with its per-conversation sequence number.
export interface StoredEvent {
  seq: number
  event: ServerEvent
}

export interface CreateConversationRequest {
  agent: AgentName
  cwd: string
  title?: string
}

export interface ConversationDetail {
  conversation: Conversation
  transcript: StoredEvent[]
}
```

- [ ] **Step 3: Re-export from `packages/protocol/src/index.ts`**

```ts
export * from './events'
export * from './parse'
export * from './rest'
```

- [ ] **Step 4: Write `packages/protocol/test/rest.test.ts`**

This is a compile-level contract test (the DTOs are types); it asserts the values are constructible and `user_text` is a valid `ServerEvent`.

```ts
import { describe, expect, it } from 'vitest'
import type { Conversation, ServerEvent, StoredEvent, Workspace } from '../src/index'

describe('rest dtos', () => {
  it('builds a Conversation and Workspace', () => {
    const ws: Workspace = { root: '/repo', worktrees: [{ path: '/repo', branch: 'main' }] }
    const conv: Conversation = {
      id: 'c1', agent: 'claude', cwd: '/repo', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
    }
    expect(ws.worktrees[0]?.branch).toBe('main')
    expect(conv.agent).toBe('claude')
  })

  it('accepts user_text as a ServerEvent in a StoredEvent', () => {
    const stored: StoredEvent = { seq: 0, event: { type: 'user_text', turn_id: 't1', text: 'hi' } }
    const event: ServerEvent = stored.event
    expect(event.type).toBe('user_text')
  })
})
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @trux/protocol test && pnpm --filter @trux/protocol typecheck`
Expected: PASS (existing parse tests + 2 new); typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add packages/protocol
git commit -m "feat(protocol): add user_text event and REST DTOs"
```

---

## Task 2: Backend config — workspace roots

**Files:**
- Modify: `apps/backend/src/config.ts`
- Modify: `apps/backend/test/config.test.ts`

- [ ] **Step 1: Update the failing test `apps/backend/test/config.test.ts`**

Add `workspaceRoots` to the two existing assertions. In the defaults test add:

```ts
    expect(config.workspaceRoots).toEqual([])
```

In the overrides test, set the env and extend the `toEqual` object:

```ts
    process.env.TRUX_WORKSPACES = '/a:/b'
    const config = loadConfig()
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 5000,
      dbPath: '/tmp/x.db',
      secret: 's3cret',
      authRequired: true,
      workspaceRoots: ['/a', '/b'],
    })
```

Also add `'TRUX_WORKSPACES'` to the `KEYS` array at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test config`
Expected: FAIL — `workspaceRoots` undefined / object mismatch.

- [ ] **Step 3: Update `apps/backend/src/config.ts`**

Add the field to the `Config` interface:

```ts
export interface Config {
  host: string
  port: number
  dbPath: string
  secret: string | null
  authRequired: boolean
  workspaceRoots: string[]
}
```

Add to the returned object in `loadConfig`:

```ts
    workspaceRoots: env.TRUX_WORKSPACES ? env.TRUX_WORKSPACES.split(':').filter(Boolean) : [],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test config`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/config.ts apps/backend/test/config.test.ts
git commit -m "feat(backend): add workspace roots config (TRUX_WORKSPACES)"
```

---

## Task 3: Backend registry (sqlite CRUD)

**Files:**
- Create: `apps/backend/src/registry.ts`
- Test: `apps/backend/test/registry.test.ts`

- [ ] **Step 1: Write the failing test `apps/backend/test/registry.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type TruxDatabase } from '../src/db'
import { SqliteRegistry } from '../src/registry'

let db: TruxDatabase
let registry: SqliteRegistry

beforeEach(() => {
  db = openDb(':memory:')
  registry = new SqliteRegistry(db)
})
afterEach(() => db.close())

describe('SqliteRegistry', () => {
  it('creates and lists a conversation', () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo', title: 'T' })
    expect(conv.id).toBeTruthy()
    expect(conv.status).toBe('idle')
    expect(conv.archived).toBe(false)
    expect(registry.listConversations().map((c) => c.id)).toEqual([conv.id])
  })

  it('appends events with monotonic per-conversation seq and loads them in order', () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const a = registry.appendEvent(conv.id, { type: 'user_text', turn_id: 't1', text: 'hi' })
    const b = registry.appendEvent(conv.id, { type: 'text', turn_id: 't1', text: 'hello' })
    expect([a.seq, b.seq]).toEqual([0, 1])
    const transcript = registry.loadTranscript(conv.id)
    expect(transcript.map((s) => s.event.type)).toEqual(['user_text', 'text'])
    expect(transcript[1]?.seq).toBe(1)
  })

  it('mirrors status and native session id onto the conversation row', () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    registry.setStatus(conv.id, 'thinking')
    registry.setNativeSessionId(conv.id, 'sess_1')
    const got = registry.getConversation(conv.id)
    expect(got?.status).toBe('thinking')
    expect(got?.native_session_id).toBe('sess_1')
  })

  it('archives a conversation (hidden from list)', () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    registry.archiveConversation(conv.id)
    expect(registry.listConversations()).toEqual([])
    expect(registry.getConversation(conv.id)?.archived).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test registry`
Expected: FAIL — `registry.ts` / `SqliteRegistry` does not exist.

- [ ] **Step 3: Create `apps/backend/src/registry.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type {
  AgentName,
  Conversation,
  ConversationStatus,
  CreateConversationRequest,
  ServerEvent,
  StoredEvent,
} from '@trux/protocol'
import type { TruxDatabase } from './db'

interface ConversationRow {
  id: string
  agent: string
  cwd: string
  title: string | null
  status: string
  native_session_id: string | null
  archived: number
  created_at: number
  updated_at: number
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    agent: row.agent as AgentName,
    cwd: row.cwd,
    title: row.title,
    status: row.status as ConversationStatus,
    native_session_id: row.native_session_id,
    archived: row.archived === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// Owns the conversations + events tables: lifecycle, status mirror, and the
// append-only transcript with per-conversation seq allocation.
export class SqliteRegistry {
  constructor(private readonly db: TruxDatabase) {}

  createConversation(input: CreateConversationRequest): Conversation {
    const now = Date.now()
    const row: ConversationRow = {
      id: randomUUID(),
      agent: input.agent,
      cwd: input.cwd,
      title: input.title ?? null,
      status: 'idle',
      native_session_id: null,
      archived: 0,
      created_at: now,
      updated_at: now,
    }
    this.db
      .prepare(
        `INSERT INTO conversations
         (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at)
         VALUES (@id, @agent, @cwd, @title, @status, @native_session_id, @archived, @created_at, @updated_at)`,
      )
      .run(row)
    return toConversation(row)
  }

  listConversations(): Conversation[] {
    return (
      this.db
        .prepare('SELECT * FROM conversations WHERE archived = 0 ORDER BY updated_at DESC')
        .all() as ConversationRow[]
    ).map(toConversation)
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | ConversationRow
      | undefined
    return row ? toConversation(row) : null
  }

  setStatus(id: string, status: ConversationStatus): void {
    this.db
      .prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
  }

  setNativeSessionId(id: string, nativeSessionId: string): void {
    this.db
      .prepare('UPDATE conversations SET native_session_id = ?, updated_at = ? WHERE id = ?')
      .run(nativeSessionId, Date.now(), id)
  }

  archiveConversation(id: string): void {
    this.db
      .prepare('UPDATE conversations SET archived = 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id)
  }

  appendEvent(convId: string, event: ServerEvent): StoredEvent {
    const { next } = this.db
      .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM events WHERE conversation_id = ?')
      .get(convId) as { next: number }
    this.db
      .prepare(
        'INSERT INTO events (conversation_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(convId, next, event.type, JSON.stringify(event), Date.now())
    return { seq: next, event }
  }

  loadTranscript(convId: string): StoredEvent[] {
    return (
      this.db
        .prepare('SELECT seq, payload FROM events WHERE conversation_id = ? ORDER BY seq')
        .all(convId) as { seq: number; payload: string }[]
    ).map((r) => ({ seq: r.seq, event: JSON.parse(r.payload) as ServerEvent }))
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test registry`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/registry.ts apps/backend/test/registry.test.ts
git commit -m "feat(backend): sqlite ConversationRegistry (CRUD + transcript)"
```

---

## Task 4: Backend workspaces service

**Files:**
- Create: `apps/backend/src/workspaces.ts`
- Test: `apps/backend/test/workspaces.test.ts`

- [ ] **Step 1: Write the failing test `apps/backend/test/workspaces.test.ts`**

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorkspaces, parseWorktrees } from '../src/workspaces'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('parseWorktrees', () => {
  it('parses porcelain output into path + branch', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/feat',
      'HEAD def456',
      'branch refs/heads/feat',
      '',
    ].join('\n')
    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/.worktrees/feat', branch: 'feat' },
    ])
  })

  it('reports a detached worktree branch as null', () => {
    const porcelain = ['worktree /repo', 'HEAD abc123', 'detached', ''].join('\n')
    expect(parseWorktrees(porcelain)).toEqual([{ path: '/repo', branch: null }])
  })
})

describe('listWorkspaces', () => {
  it('enumerates worktrees for a real git repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-ws-'))
    dirs.push(root)
    execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'])
    execFileSync('git', ['-C', root, 'config', 'user.email', 't@t'])
    execFileSync('git', ['-C', root, 'config', 'user.name', 't'])
    execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init'])
    const [ws] = listWorkspaces([root])
    expect(ws?.root).toBe(root)
    expect(ws?.worktrees[0]?.branch).toBe('main')
  })

  it('degrades a non-git directory to a single branchless entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-plain-'))
    dirs.push(root)
    expect(listWorkspaces([root])).toEqual([{ root, worktrees: [{ path: root, branch: null }] }])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test workspaces`
Expected: FAIL — `workspaces.ts` does not exist.

- [ ] **Step 3: Create `apps/backend/src/workspaces.ts`**

```ts
import { execFileSync } from 'node:child_process'
import type { Workspace, Worktree } from '@trux/protocol'

// Parse `git worktree list --porcelain` into worktree records.
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = []
  let path: string | null = null
  let branch: string | null = null
  const flush = (): void => {
    if (path) out.push({ path, branch })
    path = null
    branch = null
  }
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).replace('refs/heads/', '')
    } else if (line === '') {
      flush()
    }
  }
  flush()
  return out
}

// For each configured root, list its git worktrees; a non-repo degrades to itself.
export function listWorkspaces(roots: string[]): Workspace[] {
  return roots.map((root) => {
    try {
      const porcelain = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], {
        encoding: 'utf8',
      })
      const worktrees = parseWorktrees(porcelain)
      return { root, worktrees: worktrees.length > 0 ? worktrees : [{ path: root, branch: null }] }
    } catch {
      return { root, worktrees: [{ path: root, branch: null }] }
    }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test workspaces`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/workspaces.ts apps/backend/test/workspaces.test.ts
git commit -m "feat(backend): workspace + git worktree enumeration"
```

---

## Task 5: Adapter interface + input queue (+ install SDK)

**Files:**
- Modify: `apps/backend/package.json` (add `@anthropic-ai/claude-agent-sdk`)
- Create: `apps/backend/src/adapter/queue.ts`
- Create: `apps/backend/src/adapter/types.ts`
- Test: `apps/backend/test/adapter/queue.test.ts`

- [ ] **Step 1: Add the SDK dependency**

Edit `apps/backend/package.json` — add to `dependencies`:

```json
    "@anthropic-ai/claude-agent-sdk": "^0.3.178",
```

Then from the repo root run `pnpm install`.
Expected: installs without error.

- [ ] **Step 2: Write the failing test `apps/backend/test/adapter/queue.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { PushQueue } from '../../src/adapter/queue'

describe('PushQueue', () => {
  it('yields items pushed before iteration', async () => {
    const q = new PushQueue<number>()
    q.push(1)
    q.push(2)
    q.end()
    const seen: number[] = []
    for await (const n of q.iterable()) seen.push(n)
    expect(seen).toEqual([1, 2])
  })

  it('awaits items pushed after iteration starts', async () => {
    const q = new PushQueue<number>()
    const seen: number[] = []
    const consumer = (async () => {
      for await (const n of q.iterable()) {
        seen.push(n)
        if (seen.length === 2) q.end()
      }
    })()
    q.push(10)
    await Promise.resolve()
    q.push(20)
    await consumer
    expect(seen).toEqual([10, 20])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test queue`
Expected: FAIL — `queue.ts` does not exist.

- [ ] **Step 4: Create `apps/backend/src/adapter/queue.ts`**

```ts
// An async-generator-backed queue: producers push() messages, the SDK consumes
// them via iterable(). Backs the streaming-input prompt of a long-lived query().
export class PushQueue<T> {
  private items: T[] = []
  private waiters: ((r: IteratorResult<T>) => void)[] = []
  private done = false

  push(item: T): void {
    if (this.done) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: item, done: false })
    else this.items.push(item)
  }

  end(): void {
    this.done = true
    let waiter: ((r: IteratorResult<T>) => void) | undefined
    while ((waiter = this.waiters.shift())) waiter({ value: undefined as never, done: true })
  }

  async *iterable(): AsyncGenerator<T> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift() as T
        continue
      }
      if (this.done) return
      const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve))
      if (result.done) return
      yield result.value
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test queue`
Expected: PASS (2 tests).

- [ ] **Step 6: Create `apps/backend/src/adapter/types.ts`**

```ts
import type { AgentName, ToolResultStatus } from '@trux/protocol'

// NCP events as the adapter produces them: no turn_id (a conversation concern the
// manager stamps) and no seq (allocated by the registry).
export type AdapterEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool_id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_id: string; status: ToolResultStatus; output: string }
  | { type: 'turn_complete'; usage?: { input: number; output: number }; cost?: number | null }
  | { type: 'error'; message: string; recoverable: boolean }

export interface AgentSession {
  send(text: string): void
  events(): AsyncIterable<AdapterEvent>
  interrupt(): Promise<void>
  close(): Promise<void>
  nativeSessionId(): string | null
}

export interface AgentAdapter {
  readonly name: AgentName
  start(opts: { cwd: string; resume?: string }): AgentSession
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm --filter @trux/backend typecheck
git add apps/backend/package.json apps/backend/src/adapter pnpm-lock.yaml apps/backend/test/adapter
git commit -m "feat(backend): adapter interface + push queue; add claude-agent-sdk"
```

---

## Task 6: ClaudeAdapter (SDK → NCP mapping)

**Files:**
- Create: `apps/backend/src/adapter/claude.ts`
- Test: `apps/backend/test/adapter/claude.test.ts`

The adapter injects `query` so tests drive a fake async generator of SDK-shaped messages through the full mapping table — no network, no real Claude.

- [ ] **Step 1: Write the failing test `apps/backend/test/adapter/claude.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../../src/adapter/claude'
import type { AdapterEvent } from '../../src/adapter/types'

// Build a fake `query` that yields the given SDK messages and records prompts/interrupts.
function fakeQuery(messages: unknown[]) {
  const calls: { interrupted: boolean } = { interrupted: false }
  const fn = (() => {
    const iterable = {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m
      },
      interrupt: async () => {
        calls.interrupted = true
      },
      close: async () => {},
    }
    return iterable
  }) as unknown as ConstructorParameters<typeof ClaudeAdapter>[0]
  return { fn, calls }
}

async function collect(events: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> {
  const out: AdapterEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

describe('ClaudeAdapter mapping', () => {
  it('maps system/stream/assistant/user/result messages to NCP adapter events', async () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'sess_1' },
      { type: 'stream_event', stream_event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } },
      { type: 'stream_event', stream_event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } },
      { type: 'assistant', session_id: 'sess_1', message: { content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
      ] } },
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'a\nb', is_error: false },
      ] } },
      { type: 'result', subtype: 'success', session_id: 'sess_1', total_cost_usd: 0.01,
        usage: { input_tokens: 12, output_tokens: 34 } },
    ]
    const { fn } = fakeQuery(messages)
    const adapter = new ClaudeAdapter(fn)
    const session = adapter.start({ cwd: '/repo' })
    const events = await collect(session.events())
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'text', text: 'Hello' },
      { type: 'tool_call', tool_id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', tool_id: 'tu_1', status: 'ok', output: 'a\nb' },
      { type: 'turn_complete', usage: { input: 12, output: 34 }, cost: 0.01 },
    ])
    expect(session.nativeSessionId()).toBe('sess_1')
  })

  it('marks an errored tool_result with status error', async () => {
    const messages = [
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_9', content: 'boom', is_error: true },
      ] } },
    ]
    const { fn } = fakeQuery(messages)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const events = await collect(session.events())
    expect(events).toEqual([{ type: 'tool_result', tool_id: 'tu_9', status: 'error', output: 'boom' }])
  })

  it('forwards interrupt to the underlying query', async () => {
    const { fn, calls } = fakeQuery([])
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    await session.interrupt()
    expect(calls.interrupted).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test claude`
Expected: FAIL — `claude.ts` / `ClaudeAdapter` does not exist.

- [ ] **Step 3: Create `apps/backend/src/adapter/claude.ts`**

```ts
import { query as realQuery } from '@anthropic-ai/claude-agent-sdk'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'

// The SDK's exact message/content types live behind skipLibCheck; we narrow the
// few fields we read. `query` is injected so tests can drive a fake generator.
type QueryFn = typeof realQuery
type SdkUserMessage = { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }

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
  // The query object is an async-iterable with interrupt()/close() control methods.
  constructor(
    private readonly q: AsyncIterable<unknown> & { interrupt(): Promise<void>; close?(): Promise<void> },
    private readonly inbox: PushQueue<SdkUserMessage>,
  ) {}

  send(text: string): void {
    this.inbox.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
  }

  async *events(): AsyncIterable<AdapterEvent> {
    for await (const raw of this.q) {
      const msg = raw as Record<string, unknown>
      if (typeof msg.session_id === 'string') this.sessionId = msg.session_id

      switch (msg.type) {
        case 'stream_event': {
          const ev = msg.stream_event as { type?: string; delta?: { type?: string; text?: string } }
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            yield { type: 'text_delta', text: ev.delta.text ?? '' }
          }
          break
        }
        case 'assistant': {
          const content = (msg.message as { content?: unknown[] })?.content ?? []
          for (const b of content) {
            const block = b as Record<string, unknown>
            if (block.type === 'text') {
              yield { type: 'text', text: String(block.text ?? '') }
            } else if (block.type === 'tool_use') {
              yield {
                type: 'tool_call',
                tool_id: String(block.id ?? ''),
                name: String(block.name ?? ''),
                input: block.input,
              }
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
                yield {
                  type: 'tool_result',
                  tool_id: String(block.tool_use_id ?? ''),
                  status: block.is_error ? 'error' : 'ok',
                  output: stringifyToolOutput(block.content),
                }
              }
            }
          }
          break
        }
        case 'result': {
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined
          yield {
            type: 'turn_complete',
            usage: { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 },
            cost: (msg.total_cost_usd as number | undefined) ?? null,
          }
          break
        }
      }
    }
  }

  async interrupt(): Promise<void> {
    await this.q.interrupt()
  }
  async close(): Promise<void> {
    await this.q.close?.()
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
    const q = this.queryFn({
      // The SDK accepts an AsyncIterable of user messages for streaming-input mode.
      prompt: inbox.iterable() as never,
      options: { cwd, permissionMode: 'bypassPermissions', includePartialMessages: true, resume },
    }) as AsyncIterable<unknown> & { interrupt(): Promise<void>; close?(): Promise<void> }
    return new ClaudeSession(q, inbox)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test claude`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm --filter @trux/backend typecheck
git add apps/backend/src/adapter/claude.ts apps/backend/test/adapter/claude.test.ts
git commit -m "feat(backend): ClaudeAdapter maps Agent SDK messages to NCP"
```

---

## Task 7: ConversationManager (turn lifecycle + persistence)

**Files:**
- Create: `apps/backend/src/manager.ts`
- Test: `apps/backend/test/manager.test.ts`

- [ ] **Step 1: Write the failing test `apps/backend/test/manager.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerEvent } from '@trux/protocol'
import { openDb, type TruxDatabase } from '../src/db'
import { SqliteRegistry } from '../src/registry'
import { ConversationManager } from '../src/manager'
import type { AdapterEvent, AgentAdapter, AgentSession } from '../src/adapter/types'
import { PushQueue } from '../src/adapter/queue'

// A fake adapter whose session replays a scripted AdapterEvent stream per turn.
class FakeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  last!: FakeSession
  constructor(private readonly script: AdapterEvent[]) {}
  start(): AgentSession {
    this.last = new FakeSession(this.script)
    return this.last
  }
}
class FakeSession implements AgentSession {
  interrupted = false
  private outbox = new PushQueue<AdapterEvent>()
  constructor(private readonly script: AdapterEvent[]) {}
  send(): void {
    for (const e of this.script) this.outbox.push(e)
    this.outbox.end()
  }
  events(): AsyncIterable<AdapterEvent> {
    return this.outbox.iterable()
  }
  async interrupt(): Promise<void> {
    this.interrupted = true
  }
  async close(): Promise<void> {}
  nativeSessionId(): string | null {
    return 'sess_fake'
  }
}

let db: TruxDatabase
let registry: SqliteRegistry

beforeEach(() => {
  db = openDb(':memory:')
  registry = new SqliteRegistry(db)
})
afterEach(() => db.close())

function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10))
}

describe('ConversationManager', () => {
  it('runs a turn: emits user_text, turn_started, status, mapped events, turn_complete, idle', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'text', text: 'Hi there' },
      { type: 'turn_complete', usage: { input: 1, output: 2 }, cost: 0 },
    ])
    const manager = new ConversationManager(registry, adapter)
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))

    await manager.handleUserMessage(conv.id, 'hello')
    await settle()

    expect(seen.map((e) => e.type)).toEqual([
      'user_text', 'turn_started', 'status', 'text', 'turn_complete', 'status',
    ])
    const first = seen[1] as { turn_id: string }
    const text = seen[3] as { turn_id: string }
    expect(text.turn_id).toBe(first.turn_id) // events stamped with the open turn id
    expect((seen.at(-1) as { state: string }).state).toBe('idle')
  })

  it('persists every event except text_delta, and mirrors native session id', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'text_delta', text: 'Hi' },
      { type: 'text', text: 'Hi' },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, adapter)
    manager.attach(conv.id, () => {})
    await manager.handleUserMessage(conv.id, 'hello')
    await settle()

    const stored = registry.loadTranscript(conv.id).map((s) => s.event.type)
    expect(stored).not.toContain('text_delta')
    expect(stored).toContain('user_text')
    expect(stored).toContain('text')
    expect(registry.getConversation(conv.id)?.native_session_id).toBe('sess_fake')
    expect(registry.getConversation(conv.id)?.status).toBe('idle')
  })

  it('forwards interrupt to the live session', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([{ type: 'turn_complete', cost: 0 }])
    const manager = new ConversationManager(registry, adapter)
    manager.attach(conv.id, () => {})
    await manager.handleUserMessage(conv.id, 'hello')
    await manager.interrupt(conv.id)
    expect(adapter.last.interrupted).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test manager`
Expected: FAIL — `manager.ts` / `ConversationManager` does not exist.

- [ ] **Step 3: Create `apps/backend/src/manager.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { ServerEvent } from '@trux/protocol'
import type { AdapterEvent, AgentAdapter, AgentSession } from './adapter/types'
import type { SqliteRegistry } from './registry'

type Listener = (event: ServerEvent) => void

interface LiveSession {
  session: AgentSession
  currentTurnId: string | null
}

// Stamp an adapter event (no turn_id) into a wire ServerEvent for the open turn.
function stampTurn(e: AdapterEvent, turnId: string): ServerEvent {
  switch (e.type) {
    case 'text_delta':
      return { type: 'text_delta', turn_id: turnId, text: e.text }
    case 'text':
      return { type: 'text', turn_id: turnId, text: e.text }
    case 'tool_call':
      return { type: 'tool_call', turn_id: turnId, tool_id: e.tool_id, name: e.name, input: e.input }
    case 'tool_result':
      return { type: 'tool_result', turn_id: turnId, tool_id: e.tool_id, status: e.status, output: e.output }
    case 'turn_complete':
      return { type: 'turn_complete', turn_id: turnId, usage: e.usage, cost: e.cost }
    case 'error':
      return { type: 'error', message: e.message, recoverable: e.recoverable }
  }
}

// The single bridge: WS ↔ adapter ↔ registry. Owns turn ids, status, and the
// persist-before-broadcast ordering (text_delta is broadcast-only).
export class ConversationManager {
  private live = new Map<string, LiveSession>()
  private listeners = new Map<string, Set<Listener>>()

  constructor(
    private readonly registry: SqliteRegistry,
    private readonly adapter: AgentAdapter,
  ) {}

  attach(convId: string, listener: Listener): () => void {
    const set = this.listeners.get(convId) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(convId, set)
    return () => set.delete(listener)
  }

  async handleUserMessage(convId: string, text: string): Promise<void> {
    const live = this.ensureSession(convId)
    const turnId = `t_${randomUUID().slice(0, 8)}`
    live.currentTurnId = turnId
    this.emit(convId, { type: 'user_text', turn_id: turnId, text })
    this.emit(convId, { type: 'turn_started', turn_id: turnId })
    this.emit(convId, { type: 'status', state: 'thinking' })
    live.session.send(text)
  }

  async interrupt(convId: string): Promise<void> {
    await this.live.get(convId)?.session.interrupt()
  }

  private ensureSession(convId: string): LiveSession {
    const existing = this.live.get(convId)
    if (existing) return existing
    const conv = this.registry.getConversation(convId)
    if (!conv) throw new Error(`unknown conversation ${convId}`)
    const session = this.adapter.start({
      cwd: conv.cwd,
      resume: conv.native_session_id ?? undefined,
    })
    const live: LiveSession = { session, currentTurnId: null }
    this.live.set(convId, live)
    void this.pump(convId, live)
    return live
  }

  private async pump(convId: string, live: LiveSession): Promise<void> {
    try {
      for await (const e of live.session.events()) {
        const wire = stampTurn(e, live.currentTurnId ?? '')
        this.emit(convId, wire)
        if (wire.type === 'turn_complete') {
          const sid = live.session.nativeSessionId()
          if (sid) this.registry.setNativeSessionId(convId, sid)
          this.emit(convId, { type: 'status', state: 'idle' })
          live.currentTurnId = null
        }
      }
    } catch (err) {
      this.emit(convId, { type: 'error', message: String(err), recoverable: true })
      this.emit(convId, { type: 'status', state: 'error' })
    }
  }

  // Persist (everything but text_delta) then broadcast to attached sockets.
  private emit(convId: string, event: ServerEvent): void {
    if (event.type !== 'text_delta') {
      this.registry.appendEvent(convId, event)
      if (event.type === 'status') this.registry.setStatus(convId, event.state)
    }
    for (const listener of this.listeners.get(convId) ?? []) listener(event)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test manager`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/manager.ts apps/backend/test/manager.test.ts
git commit -m "feat(backend): ConversationManager turn lifecycle + persistence"
```

---

## Task 8: REST routes + WS turn engine + wiring

**Files:**
- Create: `apps/backend/src/auth.ts`
- Create: `apps/backend/src/routes.ts`
- Create: `apps/backend/src/stream.ts`
- Modify: `apps/backend/src/server.ts`
- Modify: `apps/backend/src/index.ts`
- Test: `apps/backend/test/routes.test.ts` (extends the Phase 0 `server.test.ts` style)

- [ ] **Step 1: Create `apps/backend/src/auth.ts`** (extract from Phase 0 `server.ts`)

```ts
import { timingSafeEqual } from 'node:crypto'
import type { Config } from './config'

// Constant-time secret compare — the auth boundary is the RCE boundary.
export function tokenMatches(secret: string, token: string): boolean {
  const a = Buffer.from(secret)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

// True when a presented token is acceptable under the current config.
export function tokenAccepted(config: Config, token: string | null): boolean {
  if (!config.authRequired) return true
  return config.secret !== null && token !== null && tokenMatches(config.secret, token)
}
```

- [ ] **Step 2: Create `apps/backend/src/routes.ts`** (REST: conversations + workspaces)

```ts
import type { FastifyInstance } from 'fastify'
import type { ConversationDetail, CreateConversationRequest } from '@trux/protocol'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import { listWorkspaces } from './workspaces'
import { tokenAccepted } from './auth'

export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
): void {
  // Bearer gate for REST (no-op locally when authRequired is false).
  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/health') return
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
    if (!tokenAccepted(config, token)) {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.get('/workspaces', async () => listWorkspaces(config.workspaceRoots))

  app.get('/conversations', async () => registry.listConversations())

  app.post('/conversations', async (req, reply) => {
    const body = req.body as CreateConversationRequest
    if (!body || body.agent !== 'claude' || typeof body.cwd !== 'string' || body.cwd.length === 0) {
      return reply.code(400).send({ error: 'agent must be "claude" and cwd is required' })
    }
    return registry.createConversation({ agent: 'claude', cwd: body.cwd, title: body.title })
  })

  app.get('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conversation = registry.getConversation(id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    const detail: ConversationDetail = { conversation, transcript: registry.loadTranscript(id) }
    return detail
  })

  app.patch('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as { archived?: boolean }
    if (body.archived === true) registry.archiveConversation(id)
    const conversation = registry.getConversation(id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    return conversation
  })
}
```

- [ ] **Step 3: Create `apps/backend/src/stream.ts`** (WS turn engine)

```ts
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { parseClientMessage, PROTOCOL_VERSION, type ServerEvent } from '@trux/protocol'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import type { ConversationManager } from './manager'
import { tokenAccepted } from './auth'

function send(socket: WebSocket, event: ServerEvent): void {
  socket.send(JSON.stringify(event))
}

export function registerStream(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
  manager: ConversationManager,
): void {
  app.register(async (scope) => {
    scope.get('/conversations/:id/stream', { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string }
      let authed = false
      let detach: (() => void) | null = null

      socket.on('close', () => detach?.())

      socket.on('message', (raw: Buffer) => {
        const msg = parseClientMessage(raw.toString())
        if (!msg) {
          send(socket, { type: 'error', message: 'invalid message', recoverable: true })
          return
        }

        if (!authed) {
          if (msg.type !== 'auth') {
            send(socket, { type: 'error', message: 'auth required as first message', recoverable: false })
            socket.close()
            return
          }
          if (!tokenAccepted(config, msg.token)) {
            send(socket, { type: 'error', message: 'unauthorized', recoverable: false })
            socket.close()
            return
          }
          if (!registry.getConversation(id)) {
            send(socket, { type: 'error', message: 'unknown conversation', recoverable: false })
            socket.close()
            return
          }
          authed = true
          send(socket, { type: 'hello', protocol_version: PROTOCOL_VERSION, server: 'trux' })
          // Attach to live events for this conversation (history is restored via REST).
          detach = manager.attach(id, (event) => send(socket, event))
          return
        }

        if (msg.type === 'user_message') {
          void manager.handleUserMessage(id, msg.text)
        } else if (msg.type === 'interrupt') {
          void manager.interrupt(id)
        } else {
          // approval_response is Phase 2.
          send(socket, { type: 'error', message: 'not supported in phase 1', recoverable: true })
        }
      })
    })
  })
}
```

- [ ] **Step 4: Replace `apps/backend/src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { Config } from './config'
import type { TruxDatabase } from './db'
import type { SqliteRegistry } from './registry'
import type { ConversationManager } from './manager'
import { registerRoutes } from './routes'
import { registerStream } from './stream'

export async function buildServer(
  config: Config,
  db: TruxDatabase,
  registry: SqliteRegistry,
  manager: ConversationManager,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)

  app.get('/health', async () => {
    const { n } = db.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }
    return { ok: true, conversations: n }
  })

  registerRoutes(app, config, registry)
  registerStream(app, config, registry, manager)

  return app
}
```

- [ ] **Step 5: Update `apps/backend/src/index.ts`**

```ts
import 'dotenv/config'
import { loadConfig } from './config'
import { openDb } from './db'
import { SqliteRegistry } from './registry'
import { ClaudeAdapter } from './adapter/claude'
import { ConversationManager } from './manager'
import { buildServer } from './server'

async function main(): Promise<void> {
  const config = loadConfig()
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`invalid TRUX_PORT: ${process.env.TRUX_PORT}`)
  }
  const db = openDb(config.dbPath)
  const registry = new SqliteRegistry(db)
  const manager = new ConversationManager(registry, new ClaudeAdapter())
  const app = await buildServer(config, db, registry, manager)
  await app.listen({ host: config.host, port: config.port })
  console.log(`trux backend listening on http://${config.host}:${config.port} (db: ${config.dbPath})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 6: Replace `apps/backend/test/server.test.ts` with `apps/backend/test/routes.test.ts`**

Delete the old file and create the new one (real Fastify + a fake adapter injected into a real manager):

```ts
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import type { FastifyInstance } from 'fastify'
import type { Conversation, ConversationDetail, ServerEvent } from '@trux/protocol'
import { buildServer } from '../src/server'
import { openDb, type TruxDatabase } from '../src/db'
import { SqliteRegistry } from '../src/registry'
import { ConversationManager } from '../src/manager'
import type { AdapterEvent, AgentAdapter, AgentSession } from '../src/adapter/types'
import { PushQueue } from '../src/adapter/queue'
import type { Config } from '../src/config'

const baseConfig: Config = {
  host: '127.0.0.1', port: 0, dbPath: ':memory:', secret: 'test-secret',
  authRequired: false, workspaceRoots: [],
}

class FakeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  start(): AgentSession {
    const outbox = new PushQueue<AdapterEvent>()
    return {
      send: () => {
        outbox.push({ type: 'text', text: 'pong' })
        outbox.push({ type: 'turn_complete', cost: 0 })
        outbox.end()
      },
      events: () => outbox.iterable(),
      interrupt: async () => {},
      close: async () => {},
      nativeSessionId: () => 'sess_x',
    }
  }
}

let app: FastifyInstance
let db: TruxDatabase

async function start(): Promise<{ port: number; registry: SqliteRegistry }> {
  db = openDb(':memory:')
  const registry = new SqliteRegistry(db)
  const manager = new ConversationManager(registry, new FakeAdapter())
  app = await buildServer(baseConfig, db, registry, manager)
  await app.listen({ host: '127.0.0.1', port: 0 })
  return { port: (app.server.address() as AddressInfo).port, registry }
}

afterEach(async () => {
  await app?.close()
  db?.close()
})

describe('REST', () => {
  it('creates, lists, and fetches a conversation with its transcript', async () => {
    const { port } = await start()
    const created = (await (
      await fetch(`http://127.0.0.1:${port}/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'claude', cwd: '/repo' }),
      })
    ).json()) as Conversation
    expect(created.agent).toBe('claude')

    const list = (await (await fetch(`http://127.0.0.1:${port}/conversations`)).json()) as Conversation[]
    expect(list.map((c) => c.id)).toContain(created.id)

    const detail = (await (
      await fetch(`http://127.0.0.1:${port}/conversations/${created.id}`)
    ).json()) as ConversationDetail
    expect(detail.conversation.id).toBe(created.id)
    expect(detail.transcript).toEqual([])
  })

  it('rejects a non-claude agent with 400', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'codex', cwd: '/repo' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('WS turn engine', () => {
  function runTurn(port: number, convId: string): Promise<ServerEvent[]> {
    return new Promise((resolve, reject) => {
      const events: ServerEvent[] = []
      const ws = new WebSocket(`ws://127.0.0.1:${port}/conversations/${convId}/stream`)
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: '' })))
      ws.on('message', (raw) => {
        const event = JSON.parse(raw.toString()) as ServerEvent
        events.push(event)
        if (event.type === 'hello') ws.send(JSON.stringify({ type: 'user_message', text: 'ping' }))
        if (event.type === 'status' && event.state === 'idle') {
          ws.close()
          resolve(events)
        }
      })
      ws.on('error', reject)
    })
  }

  it('streams a full turn and persists it to the transcript', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const events = await runTurn(port, conv.id)
    expect(events.map((e) => e.type)).toEqual([
      'hello', 'user_text', 'turn_started', 'status', 'text', 'turn_complete', 'status',
    ])
    // Reload: transcript persisted (minus hello, which is a live handshake only).
    const stored = registry.loadTranscript(conv.id).map((s) => s.event.type)
    expect(stored).toEqual(['user_text', 'turn_started', 'status', 'text', 'turn_complete', 'status'])
  })

  it('rejects a stream for an unknown conversation', async () => {
    const { port } = await start()
    const events = await new Promise<ServerEvent[]>((resolve, reject) => {
      const out: ServerEvent[] = []
      const ws = new WebSocket(`ws://127.0.0.1:${port}/conversations/nope/stream`)
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: '' })))
      ws.on('message', (raw) => {
        out.push(JSON.parse(raw.toString()) as ServerEvent)
        ws.close()
        resolve(out)
      })
      ws.on('error', reject)
    })
    expect(events[0]).toEqual({ type: 'error', message: 'unknown conversation', recoverable: false })
  })
})
```

- [ ] **Step 7: Run the backend suite**

Run: `pnpm --filter @trux/backend test`
Expected: PASS (config, db, registry, workspaces, queue, claude, manager, routes).

- [ ] **Step 8: Typecheck + commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm --filter @trux/backend typecheck
git rm apps/backend/test/server.test.ts
git add apps/backend/src/auth.ts apps/backend/src/routes.ts apps/backend/src/stream.ts \
        apps/backend/src/server.ts apps/backend/src/index.ts apps/backend/test/routes.test.ts
git commit -m "feat(backend): REST conversations/workspaces + WS turn engine"
```

---

## Task 9: Frontend — REST client, store, client extension

**Files:**
- Create: `apps/frontend/src/api.ts`
- Create: `apps/frontend/src/store.ts`
- Modify: `apps/frontend/src/truxClient.ts`
- Test: `apps/frontend/test/store.test.ts`

- [ ] **Step 1: Create `apps/frontend/src/api.ts`**

```ts
import type {
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  Workspace,
} from '@trux/protocol'

// Optional bearer for remote; empty/absent locally (authRequired off).
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('trux_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export const api = {
  listWorkspaces: () => fetch('/workspaces', { headers: authHeaders() }).then(json<Workspace[]>),
  listConversations: () =>
    fetch('/conversations', { headers: authHeaders() }).then(json<Conversation[]>),
  getConversation: (id: string) =>
    fetch(`/conversations/${id}`, { headers: authHeaders() }).then(json<ConversationDetail>),
  createConversation: (body: CreateConversationRequest) =>
    fetch('/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    }).then(json<Conversation>),
}
```

- [ ] **Step 2: Write the failing test `apps/frontend/test/store.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { ServerEvent } from '@trux/protocol'
import { foldEvent, type TranscriptItem } from '../src/store'

function fold(events: ServerEvent[]): TranscriptItem[] {
  return events.reduce<TranscriptItem[]>(foldEvent, [])
}

describe('foldEvent', () => {
  it('accumulates text_delta into one text item and finalizes with text', () => {
    const items = fold([
      { type: 'user_text', turn_id: 't1', text: 'hi' },
      { type: 'turn_started', turn_id: 't1' },
      { type: 'text_delta', turn_id: 't1', text: 'Hel' },
      { type: 'text_delta', turn_id: 't1', text: 'lo' },
      { type: 'text', turn_id: 't1', text: 'Hello' },
    ])
    expect(items).toEqual([
      { type: 'user_text', turn_id: 't1', text: 'hi' },
      { type: 'text', turn_id: 't1', text: 'Hello' },
    ])
  })

  it('keeps tool_call and tool_result as discrete items', () => {
    const items = fold([
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'a' },
    ])
    expect(items.map((i) => i.type)).toEqual(['tool_call', 'tool_result'])
  })

  it('ignores status/turn_complete for the transcript', () => {
    const items = fold([
      { type: 'status', state: 'thinking' },
      { type: 'turn_complete', turn_id: 't1', cost: 0 },
    ])
    expect(items).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @trux/frontend test store`
Expected: FAIL — `store.ts` / `foldEvent` does not exist.

- [ ] **Step 4: Create `apps/frontend/src/store.ts`**

```ts
import { create } from 'zustand'
import type {
  Conversation,
  ServerEvent,
  TextEvent,
  ToolCallEvent,
  ToolResultEvent,
  UserTextEvent,
} from '@trux/protocol'
import { api } from './api'

export type TranscriptItem = UserTextEvent | TextEvent | ToolCallEvent | ToolResultEvent

// Pure reducer: fold a streamed NCP event into the rendered transcript. text_delta
// accumulates into the open text item; the final `text` replaces it.
export function foldEvent(items: TranscriptItem[], event: ServerEvent): TranscriptItem[] {
  switch (event.type) {
    case 'user_text':
      return [...items, event]
    case 'text_delta': {
      const last = items[items.length - 1]
      if (last && last.type === 'text' && last.turn_id === event.turn_id) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return [...items, { type: 'text', turn_id: event.turn_id, text: event.text }]
    }
    case 'text': {
      const last = items[items.length - 1]
      if (last && last.type === 'text' && last.turn_id === event.turn_id) {
        return [...items.slice(0, -1), { type: 'text', turn_id: event.turn_id, text: event.text }]
      }
      return [...items, event]
    }
    case 'tool_call':
      return [...items, event]
    case 'tool_result':
      return [...items, event]
    default:
      return items
  }
}

interface TruxState {
  conversations: Conversation[]
  currentId: string | null
  transcript: TranscriptItem[]
  status: string
  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  applyEvent: (event: ServerEvent) => void
}

export const useStore = create<TruxState>((set, get) => ({
  conversations: [],
  currentId: null,
  transcript: [],
  status: 'idle',
  async loadConversations() {
    set({ conversations: await api.listConversations() })
  },
  async selectConversation(id) {
    const detail = await api.getConversation(id)
    set({
      currentId: id,
      status: detail.conversation.status,
      transcript: detail.transcript.map((s) => s.event).reduce(foldEvent, [] as TranscriptItem[]),
    })
  },
  applyEvent(event) {
    if (event.type === 'status') {
      set({ status: event.state })
      return
    }
    set({ transcript: foldEvent(get().transcript, event) })
  },
}))
```

- [ ] **Step 5: Extend `apps/frontend/src/truxClient.ts`**

Add the two convenience methods. Update the `TruxClient` interface:

```ts
export interface TruxClient {
  send: (msg: ClientMessage) => void
  sendUserMessage: (text: string) => void
  interrupt: () => void
  close: () => void
}
```

And the returned object at the end of `connectTrux`:

```ts
  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    sendUserMessage: (text) => ws.send(JSON.stringify({ type: 'user_message', text })),
    interrupt: () => ws.send(JSON.stringify({ type: 'interrupt' })),
    close: () => ws.close(),
  }
```

- [ ] **Step 6: Run store test + typecheck**

Run: `pnpm --filter @trux/frontend test store && pnpm --filter @trux/frontend typecheck`
Expected: PASS (3 tests); typecheck clean.

- [ ] **Step 7: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/frontend/src/api.ts apps/frontend/src/store.ts apps/frontend/src/truxClient.ts \
        apps/frontend/test/store.test.ts
git commit -m "feat(frontend): REST client, Zustand store, client send/interrupt"
```

---

## Task 10: Frontend UI — sidebar, new conversation, transcript, composer

**Files:**
- Create: `apps/frontend/src/components/Sidebar.tsx`
- Create: `apps/frontend/src/components/NewConversationDialog.tsx`
- Create: `apps/frontend/src/components/Transcript.tsx`
- Create: `apps/frontend/src/components/Composer.tsx`
- Create: `apps/frontend/src/components/ConversationView.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Test: `apps/frontend/test/components.test.tsx`

- [ ] **Step 1: Create `apps/frontend/src/components/Transcript.tsx`**

```tsx
import type { TranscriptItem } from '../store'

export function Transcript({ items }: { items: TranscriptItem[] }): React.ReactElement {
  return (
    <div data-testid="transcript">
      {items.map((item, i) => {
        if (item.type === 'user_text') return <p key={i} className="msg user">{item.text}</p>
        if (item.type === 'text') return <p key={i} className="msg assistant">{item.text}</p>
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

- [ ] **Step 2: Create `apps/frontend/src/components/Composer.tsx`**

```tsx
import { useState } from 'react'

interface ComposerProps {
  busy: boolean
  onSend: (text: string) => void
  onInterrupt: () => void
}

export function Composer({ busy, onSend, onInterrupt }: ComposerProps): React.ReactElement {
  const [text, setText] = useState('')
  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }
  return (
    <div className="composer">
      <textarea
        data-testid="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Message Claude…"
      />
      {busy ? (
        <button data-testid="interrupt" onClick={onInterrupt}>Stop</button>
      ) : (
        <button data-testid="send" onClick={submit}>Send</button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `apps/frontend/src/components/NewConversationDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { Workspace } from '@trux/protocol'
import { api } from '../api'

interface Props {
  onCreated: (id: string) => void
}

export function NewConversationDialog({ onCreated }: Props): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [cwd, setCwd] = useState('')

  useEffect(() => {
    void api.listWorkspaces().then((ws) => {
      setWorkspaces(ws)
      const first = ws[0]?.worktrees[0]?.path ?? ''
      setCwd(first)
    })
  }, [])

  const create = async (): Promise<void> => {
    if (!cwd) return
    const conv = await api.createConversation({ agent: 'claude', cwd })
    onCreated(conv.id)
  }

  return (
    <div className="new-conversation">
      <select data-testid="cwd-select" value={cwd} onChange={(e) => setCwd(e.target.value)}>
        {workspaces.flatMap((w) =>
          w.worktrees.map((t) => (
            <option key={t.path} value={t.path}>
              {t.path}{t.branch ? ` (${t.branch})` : ''}
            </option>
          )),
        )}
      </select>
      <button data-testid="create" onClick={() => void create()}>New claude conversation</button>
    </div>
  )
}
```

- [ ] **Step 4: Create `apps/frontend/src/components/Sidebar.tsx`**

```tsx
import type { Conversation } from '@trux/protocol'
import { NewConversationDialog } from './NewConversationDialog'

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onCreated: (id: string) => void
}

const DOT: Record<string, string> = {
  idle: '⚪', thinking: '🟡', awaiting_approval: '🔵', error: '🔴',
}

export function Sidebar({ conversations, currentId, onSelect, onCreated }: Props): React.ReactElement {
  return (
    <aside className="sidebar">
      <NewConversationDialog onCreated={onCreated} />
      <ul data-testid="conversation-list">
        {conversations.map((c) => (
          <li
            key={c.id}
            className={c.id === currentId ? 'active' : ''}
            onClick={() => onSelect(c.id)}
          >
            <span className="badge">{c.agent}</span> {DOT[c.status] ?? '⚪'}{' '}
            {c.title ?? c.cwd}
          </li>
        ))}
      </ul>
    </aside>
  )
}
```

- [ ] **Step 5: Create `apps/frontend/src/components/ConversationView.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { connectTrux, type TruxClient } from '../truxClient'
import { useStore } from '../store'
import { Transcript } from './Transcript'
import { Composer } from './Composer'

export function ConversationView({ id }: { id: string }): React.ReactElement {
  const transcript = useStore((s) => s.transcript)
  const status = useStore((s) => s.status)
  const applyEvent = useStore((s) => s.applyEvent)
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

  return (
    <section className="conversation">
      <Transcript items={transcript} />
      <Composer
        busy={status === 'thinking'}
        onSend={(text) => client.current?.sendUserMessage(text)}
        onInterrupt={() => client.current?.interrupt()}
      />
    </section>
  )
}
```

- [ ] **Step 6: Replace `apps/frontend/src/App.tsx`**

```tsx
import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ConversationView } from './components/ConversationView'

export function App(): React.ReactElement {
  const conversations = useStore((s) => s.conversations)
  const currentId = useStore((s) => s.currentId)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  const onCreated = async (id: string): Promise<void> => {
    await loadConversations()
    await selectConversation(id)
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onSelect={(id) => void selectConversation(id)}
        onCreated={(id) => void onCreated(id)}
      />
      <main>
        {currentId ? (
          <ConversationView key={currentId} id={currentId} />
        ) : (
          <p data-testid="empty">Select or create a conversation.</p>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 7: Write the failing test `apps/frontend/test/components.test.tsx`**

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Composer } from '../src/components/Composer'
import { Transcript } from '../src/components/Transcript'
import type { TranscriptItem } from '../src/store'

afterEach(cleanup)

describe('Composer', () => {
  it('sends trimmed text and clears the box', () => {
    const onSend = vi.fn()
    render(<Composer busy={false} onSend={onSend} onInterrupt={() => {}} />)
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '  hi  ' } })
    fireEvent.click(screen.getByTestId('send'))
    expect(onSend).toHaveBeenCalledWith('hi')
    expect(input.value).toBe('')
  })

  it('shows the interrupt button while busy', () => {
    const onInterrupt = vi.fn()
    render(<Composer busy onSend={() => {}} onInterrupt={onInterrupt} />)
    fireEvent.click(screen.getByTestId('interrupt'))
    expect(onInterrupt).toHaveBeenCalled()
  })
})

describe('Transcript', () => {
  it('renders user, assistant, and tool items', () => {
    const items: TranscriptItem[] = [
      { type: 'user_text', turn_id: 't1', text: 'hello' },
      { type: 'text', turn_id: 't1', text: 'hi back' },
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls' } },
    ]
    render(<Transcript items={items} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi back')).toBeInTheDocument()
    expect(screen.getByText(/Bash/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 8: Run the frontend suite + typecheck + build**

Run:
```bash
pnpm --filter @trux/frontend test
pnpm --filter @trux/frontend typecheck
pnpm --filter @trux/frontend build
```
Expected: all tests pass (store + components + the Phase 0 App/truxClient tests — note the Phase 0 `App.test.tsx` asserted "Connecting…", which no longer exists; update it in the next step).

- [ ] **Step 9: Fix the stale Phase 0 `App.test.tsx`**

The Phase 0 test asserted the old single-WS "Connecting…" UI. Replace `apps/frontend/test/App.test.tsx` with a test of the new empty state:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App'

afterEach(cleanup)

describe('App', () => {
  it('shows the empty state when no conversation is selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } }),
    )
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('empty')).toBeInTheDocument())
    vi.restoreAllMocks()
  })
})
```

Re-run: `pnpm --filter @trux/frontend test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/frontend/src/components apps/frontend/src/App.tsx \
        apps/frontend/test/components.test.tsx apps/frontend/test/App.test.tsx
git commit -m "feat(frontend): sidebar, workspace picker, transcript, composer"
```

---

## Task 11: End-to-end verification + roadmap

**Files:** `docs/2026-06-16-trux-roadmap.md` (checkboxes only).

- [ ] **Step 1: Whole-workspace typecheck + test**

Run:
```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm -r typecheck
pnpm -r test
```
Expected: all three packages typecheck; every suite passes.

- [ ] **Step 2: Manual live run (real Claude)**

Prereq: `claude` is logged in on the box (Pro/Max OAuth). Run:
```bash
TRUX_WORKSPACES="$HOME/dreamLand/jodulabs/trux" pnpm dev
```
Open the Vite URL. Then:
1. Click **New claude conversation** with the trux repo selected as `cwd`.
2. Prompt: `list the files in apps/backend/src and summarize what each does`.
3. Confirm: status goes **thinking**, assistant text **streams**, a `Read`/`Bash` tool call + result render, status returns **idle**.
4. **Reload the browser**, reselect the conversation → the transcript is restored from sqlite.
5. Start a longer prompt and click **Stop** → the turn interrupts.

- [ ] **Step 3: Tick roadmap Phase 1**

In `docs/2026-06-16-trux-roadmap.md`, change the five Phase 1 `- [ ]` items to `- [x]` and append ` ✓ 2026-06-16` to the "Done when" line.

- [ ] **Step 4: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add docs/2026-06-16-trux-roadmap.md
git commit -m "docs(roadmap): mark Phase 1 complete"
```

---

## Self-Review

**Spec coverage (Phase 1 design):**
- §2 SDK streaming-input contract → Task 6 (ClaudeAdapter, injected `query`, `bypassPermissions`, `includePartialMessages`). ✅
- §3 protocol REST DTOs (+ `user_text` refinement) → Task 1. ✅
- §4 registry / workspaces / adapter / manager / routes / stream modules → Tasks 3, 4, 5, 6, 7, 8. ✅
- §5 adapter mapping table (system/stream/assistant/user/result) → Task 6 test asserts the exact sequence. ✅
- §6 manager: `turn_id` stamping, `text_delta` ephemeral, persist-before-broadcast, native session id, interrupt → Task 7. ✅
- §7 data flow (REST create → WS auth/hello → user_message → stream; reload via REST) → Task 8 integration test (incl. transcript-persisted assertion) + Task 9 store hydration. ✅
- §8 frontend store + api + truxClient + components → Tasks 9, 10. ✅
- §9 deferrals: approvals rejected as "not supported in phase 1" (Task 8 stream), resume wired but not driven on startup (Task 7 `ensureSession` passes `resume` from stored id), live status only for the open conversation (REST mirror in Task 3). ✅
- §10 testing strategy → unit (3,4,5,6,7,9), integration (8), components (10), manual E2E (11). ✅

**Placeholder scan:** No TBD/TODO; every code step is complete and copy-able. The adapter narrows SDK fields defensively (skipLibCheck on) rather than depending on exact `.d.ts` block unions.

**Type consistency:** `SqliteRegistry` (methods `createConversation`/`listConversations`/`getConversation`/`setStatus`/`setNativeSessionId`/`archiveConversation`/`appendEvent`/`loadTranscript`), `AgentAdapter.start({cwd,resume})→AgentSession` (`send`/`events`/`interrupt`/`close`/`nativeSessionId`), `AdapterEvent` union, `ConversationManager(registry, adapter)` with `attach`/`handleUserMessage`/`interrupt`, `buildServer(config, db, registry, manager)`, `foldEvent`/`TranscriptItem`, `TruxClient` (`send`/`sendUserMessage`/`interrupt`/`close`) are defined once and referenced identically across tasks. The wire event `user_text` added in Task 1 is consumed in Tasks 7 (emit), 8 (assert), 9 (fold), 10 (render).

**Known follow-ups (not Phase 1 blockers):** events between a REST hydrate and WS attach are not replayed (acceptable single-user); cross-conversation live status is not pushed (sidebar shows REST-mirrored status); approvals, image attachments, and backend-restart resume are deferred per spec §9.
