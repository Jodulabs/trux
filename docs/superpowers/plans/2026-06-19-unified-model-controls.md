# Unified Model & Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface each backend's native model + controls (Claude first) through trux's one unified chat UI, carried per turn and remembered per conversation — trux declaring/rendering/routing, never deciding model behavior.

**Architecture:** Each adapter declares a static capability *manifest* (`AgentCapabilities`: first-class `models` + opaque `controls`). The frontend renders any manifest with one generic picker. A `TurnConfig {model, options}` rides conversation-create and every `user_message`; the conversation row stores the last selection (sticky); the Claude adapter maps it onto the Agent SDK's `model` + `effort` options. codex/opencode ship empty manifests (wired later).

**Tech Stack:** TypeScript monorepo (pnpm workspaces), `@trux/protocol` shared types, Fastify + better-sqlite3 backend, `@anthropic-ai/claude-agent-sdk` (`query()` `Options.model?: string`, `Options.effort?: 'low'|'medium'|'high'|'xhigh'|'max'`), React 19 frontend, vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-06-19-unified-model-controls-design.md`

**Conventions (read before starting):**
- Tests are colocated `*.test.ts` / `*.test.tsx` next to source (vitest).
- Run all tests: `pnpm -r test`. Typecheck: `pnpm -r typecheck`. Per-package: `pnpm --filter @trux/protocol test`, `pnpm --filter @trux/backend test`, `pnpm --filter @trux/frontend test`.
- The Claude adapter test injects a fake `QueryFn` (see existing `apps/backend/src/adapter/claude.test.ts` if present, or the pattern in `claude.ts` where `ClaudeAdapter` takes `queryFn` in its constructor).
- **"Default" sentinel:** trux never names a backend default. `defaultModel: null` and a control `default: ''` mean "no override" — the UI shows a leading `— default —` option (value `''`), and the adapter omits the knob from the SDK call when the value is empty. This is how trux stays out of the model-manager business.
- Commit message footer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/protocol/src/rest.ts` | modify | `ControlOption`, `AgentControl`, `AgentCapabilities`, `AgentsResponse` (manifest), `TurnConfig`; extend `CreateConversationRequest` + `Conversation` with `model`/`options`. |
| `packages/protocol/src/events.ts` | modify | Add `config?: TurnConfig` to `UserMessageMessage`. |
| `packages/protocol/src/rest.test.ts` | create | Type-level + shape assertions for the new contracts. |
| `apps/backend/src/adapter/types.ts` | modify | `capabilities()` on `AgentAdapter`; `config?` on `start` and `AgentSession.send`. |
| `apps/backend/src/adapter/claude.ts` | modify | `capabilities()` manifest; apply `config.model`/`config.options.effort` to `query()` options. |
| `apps/backend/src/adapter/claude.test.ts` | modify/create | Manifest shape; model+effort reach the faked `query()`. |
| `apps/backend/src/adapter/codex.ts` | modify | `capabilities()` → empty manifest; accept `config` param (unused for now). |
| `apps/backend/src/adapter/opencode.ts` | modify | `capabilities()` → empty manifest; accept `config` param (unused for now). |
| `apps/backend/src/db.ts` | modify | Forward-only migration: add `model`/`options` columns to `conversations`. |
| `apps/backend/src/db.test.ts` | create | Migration adds columns; idempotent on an already-migrated db. |
| `apps/backend/src/registry.ts` | modify | Persist + read `model`/`options`; seed on create; `setConfig` to update last-used. |
| `apps/backend/src/registry.test.ts` | modify/create | Round-trip; create seeds; `setConfig` updates. |
| `apps/backend/src/manager.ts` | modify | `capabilities()`; thread `config` into `handleUserMessage` → persist sticky → `ensureSession.start` + `session.send`. |
| `apps/backend/src/manager.test.ts` | modify/create | `capabilities()` aggregates adapters; `handleUserMessage` persists config + passes to session. |
| `apps/backend/src/routes.ts` | modify | `/agents` returns manifests; `POST /conversations` accepts `model`/`options`. |
| `apps/backend/src/stream.ts` | modify | Pass `msg.config` into `handleUserMessage`. |
| `apps/frontend/src/api.ts` | modify | `listAgents` returns manifests; `createConversation` carries config. |
| `apps/frontend/src/components/ControlPicker.tsx` | create | Generic renderer: model dropdown + N control dropdowns from a manifest. |
| `apps/frontend/src/components/ControlPicker.test.tsx` | create | Renders arbitrary manifest; omits model dropdown when empty; emits selection. |
| `apps/frontend/src/components/NewConversationDialog.tsx` | modify | Use `ControlPicker`; send config on create. |
| `apps/frontend/src/connectionManager.ts` | modify | `sendUserMessage` carries `config`. |
| `apps/frontend/src/components/ConversationView.tsx` | modify | Composer `ControlPicker` (per-turn), pre-filled from conversation's sticky config. |

---

## Task 1: Protocol — manifest + selection types

**Files:**
- Modify: `packages/protocol/src/rest.ts`
- Modify: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/rest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/rest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type {
  AgentCapabilities,
  AgentsResponse,
  TurnConfig,
  CreateConversationRequest,
  Conversation,
} from './rest'

describe('capability manifest + selection contracts', () => {
  it('an AgentCapabilities manifest carries models + opaque controls', () => {
    const claude: AgentCapabilities = {
      agent: 'claude',
      models: [{ value: 'claude-opus-4-8', label: 'Opus 4.8' }],
      defaultModel: null,
      controls: [
        { key: 'effort', label: 'Effort', options: [{ value: 'high', label: 'High' }], default: '' },
      ],
    }
    const resp: AgentsResponse = { agents: [claude] }
    expect(resp.agents[0].models[0].value).toBe('claude-opus-4-8')
    expect(resp.agents[0].controls[0].key).toBe('effort')
    expect(resp.agents[0].defaultModel).toBeNull()
  })

  it('TurnConfig has a first-class model and an opaque options bag', () => {
    const cfg: TurnConfig = { model: 'claude-opus-4-8', options: { effort: 'high' } }
    expect(cfg.model).toBe('claude-opus-4-8')
    expect(cfg.options.effort).toBe('high')
  })

  it('create request and conversation carry the selection', () => {
    const req: CreateConversationRequest = {
      agent: 'claude',
      cwd: '/x',
      model: null,
      options: {},
    }
    const conv: Conversation = {
      id: 'c1', agent: 'claude', cwd: '/x', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 0, updated_at: 0,
      model: 'claude-opus-4-8', options: { effort: 'high' },
    }
    expect(req.options).toEqual({})
    expect(conv.model).toBe('claude-opus-4-8')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/protocol test`
Expected: FAIL — `AgentCapabilities`, `TurnConfig`, `Conversation.model` don't exist (TS compile errors).

- [ ] **Step 3: Add the types**

In `packages/protocol/src/rest.ts`, add near the top (after `AgentName`):

```ts
// One selectable value for a model or a control. `value` is sent to the backend
// verbatim; `label` is shown in the unified UI.
export interface ControlOption {
  value: string
  label: string
}

// A generic, opaque-to-trux knob the backend exposes (effort, reasoning, …).
// trux renders it and passes the chosen value through; it never interprets `key`.
export interface AgentControl {
  key: string
  label: string
  options: ControlOption[]
  default: string // a ControlOption.value, or '' meaning "no override"
}

// A faithful manifest of one backend's native controls. `model` is first-class
// (universal, worth surfacing per conversation); everything else is opaque.
export interface AgentCapabilities {
  agent: AgentName
  models: ControlOption[]
  defaultModel: string | null // null = trux does not pick; backend default applies
  controls: AgentControl[]
}

// Per-turn / per-conversation selection. `options` is keyed by AgentControl.key.
export interface TurnConfig {
  model: string | null // null/'' = no override
  options: Record<string, string>
}
```

Replace the existing `AgentsResponse`:

```ts
// was: export interface AgentsResponse { agents: AgentName[] }
export interface AgentsResponse {
  agents: AgentCapabilities[]
}
```

Extend `CreateConversationRequest` (add the two fields):

```ts
export interface CreateConversationRequest {
  agent: AgentName
  cwd: string
  title?: string
  native_session_id?: string
  model?: string | null
  options?: Record<string, string>
}
```

Extend `Conversation` (add the two fields after `updated_at`):

```ts
  model: string | null
  options: Record<string, string>
```

- [ ] **Step 4: Add `config` to the WS user message**

In `packages/protocol/src/events.ts`, import `TurnConfig` and extend `UserMessageMessage`:

```ts
// at top with other protocol imports, if not already importing from './rest':
import type { TurnConfig } from './rest'
```
```ts
export interface UserMessageMessage {
  type: 'user_message'
  text: string
  attachments?: ImageAttachment[]
  client_message_id?: string
  config?: TurnConfig
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @trux/protocol test`
Expected: PASS (all 3 new cases green; existing protocol tests still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/rest.ts packages/protocol/src/events.ts packages/protocol/src/rest.test.ts
git commit -m "feat(protocol): capability manifest + TurnConfig selection types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Adapter seam — `capabilities()` + `config`

**Files:**
- Modify: `apps/backend/src/adapter/types.ts`
- Modify: `apps/backend/src/adapter/codex.ts`
- Modify: `apps/backend/src/adapter/opencode.ts`

- [ ] **Step 1: Extend the seam interfaces**

In `apps/backend/src/adapter/types.ts`, update the imports and both interfaces:

```ts
import type { AgentCapabilities, AgentName, ApprovalDecision, ImageAttachment, ToolResultStatus, TurnConfig } from '@trux/protocol'
```
```ts
export interface AgentSession {
  send(text: string, attachments?: ImageAttachment[], config?: TurnConfig): void
  events(): AsyncIterable<AdapterEvent>
  interrupt(): Promise<void>
  close(): Promise<void>
  nativeSessionId(): string | null
  respondApproval(requestId: string, decision: ApprovalDecision, note?: string | null): void
}

export interface AgentAdapter {
  readonly name: AgentName
  capabilities(): AgentCapabilities
  start(opts: { cwd: string; resume?: string; config?: TurnConfig }): AgentSession
}
```

- [ ] **Step 2: Run typecheck to see the seam break**

Run: `pnpm --filter @trux/backend typecheck`
Expected: FAIL — `CodexAdapter`, `OpencodeAdapter`, `ClaudeAdapter` don't implement `capabilities()`; their sessions' `send` signatures still pass (optional param is compatible). This confirms the three adapters need updating.

- [ ] **Step 3: Add empty manifests to codex + opencode**

In `apps/backend/src/adapter/codex.ts`, add to the `CodexAdapter` class (it already has `readonly name = 'codex'`):

```ts
  capabilities(): import('@trux/protocol').AgentCapabilities {
    // codex declares no controls yet — wired in a follow-up. Empty manifest
    // renders no extra UI, identical code path.
    return { agent: 'codex', models: [], defaultModel: null, controls: [] }
  }
```

In `apps/backend/src/adapter/opencode.ts`, add to the `OpencodeAdapter` class:

```ts
  capabilities(): import('@trux/protocol').AgentCapabilities {
    return { agent: 'opencode', models: [], defaultModel: null, controls: [] }
  }
```

- [ ] **Step 4: Run typecheck — Claude is the only remaining gap**

Run: `pnpm --filter @trux/backend typecheck`
Expected: FAIL — only `ClaudeAdapter` is missing `capabilities()` now (fixed in Task 3). codex/opencode compile.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/adapter/types.ts apps/backend/src/adapter/codex.ts apps/backend/src/adapter/opencode.ts
git commit -m "feat(backend): adapter seam grows capabilities() + per-turn config; codex/opencode empty manifests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Claude adapter — manifest + model/effort routing

**Files:**
- Modify: `apps/backend/src/adapter/claude.ts`
- Modify/Create: `apps/backend/src/adapter/claude.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/backend/src/adapter/claude.test.ts` (create it if absent; mirror the existing fake-`query` setup). This captures the `options` the SDK is called with:

```ts
import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from './claude'

// Minimal fake query: records the options it was constructed with, yields nothing.
function makeFakeQuery() {
  const calls: any[] = []
  const queryFn = (args: any) => {
    calls.push(args)
    const iter = {
      async *[Symbol.asyncIterator]() { /* no events */ },
      async interrupt() {},
      async close() {},
    }
    return iter as any
  }
  return { queryFn, calls }
}

describe('ClaudeAdapter capabilities + config routing', () => {
  it('declares a model list and an effort control', () => {
    const caps = new ClaudeAdapter().capabilities()
    expect(caps.agent).toBe('claude')
    expect(caps.models.map((m) => m.value)).toContain('claude-opus-4-8')
    expect(caps.controls.find((c) => c.key === 'effort')).toBeTruthy()
  })

  it('passes model + effort into the SDK query options when set', () => {
    const { queryFn, calls } = makeFakeQuery()
    const adapter = new ClaudeAdapter(queryFn as any)
    adapter.start({ cwd: '/x', config: { model: 'claude-opus-4-8', options: { effort: 'high' } } })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.model).toBe('claude-opus-4-8')
    expect(calls[0].options.effort).toBe('high')
  })

  it('omits model/effort when the selection is empty (no override)', () => {
    const { queryFn, calls } = makeFakeQuery()
    const adapter = new ClaudeAdapter(queryFn as any)
    adapter.start({ cwd: '/x', config: { model: null, options: {} } })
    expect(calls[0].options.model).toBeUndefined()
    expect(calls[0].options.effort).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/backend test -- claude`
Expected: FAIL — `capabilities` is not a function; `options.model`/`options.effort` undefined.

- [ ] **Step 3: Add the manifest**

In `apps/backend/src/adapter/claude.ts`, import the types and add `capabilities()` to `ClaudeAdapter`:

```ts
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import type { AgentCapabilities, ApprovalDecision, ImageAttachment, TurnConfig } from '@trux/protocol'
```
```ts
export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  constructor(private readonly queryFn: QueryFn = realQuery) {}

  capabilities(): AgentCapabilities {
    // Mirrors Claude Code's own surface. Model IDs are the bare SDK strings;
    // effort levels are the SDK's EffortLevel union. defaultModel is null and the
    // effort default is '' — trux does not pick; the backend's own default applies.
    return {
      agent: 'claude',
      models: [
        { value: 'claude-opus-4-8', label: 'Opus 4.8' },
        { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
      ],
      defaultModel: null,
      controls: [
        {
          key: 'effort',
          label: 'Effort',
          options: [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Extra high' },
            { value: 'max', label: 'Max' },
          ],
          default: '',
        },
      ],
    }
  }
```

- [ ] **Step 4: Route config into the query options**

Still in `ClaudeAdapter.start`, thread `config` into the `query()` options. Update the method (the existing body builds `options` for `this.queryFn`):

```ts
  start({ cwd, resume, config }: { cwd: string; resume?: string; config?: TurnConfig }): AgentSession {
    const inbox = new PushQueue<SdkUserMessage>()
    // Map the opaque selection onto the SDK's native knobs. Empty/absent = omit
    // (let the backend default apply) — trux imposes no model policy.
    const effort = config?.options?.effort
    const startQuery = (canUseTool: CanUseTool): QueryHandle =>
      this.queryFn({
        prompt: inbox.iterable() as never,
        options: {
          cwd,
          permissionMode: 'default',
          settingSources: [],
          includePartialMessages: true,
          resume,
          canUseTool: canUseTool as never,
          ...(config?.model ? { model: config.model } : {}),
          ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
        },
      }) as unknown as QueryHandle
    return new ClaudeSession(startQuery, inbox)
  }
```

- [ ] **Step 5: Accept `config` on the session `send` (interface symmetry)**

In `ClaudeSession`, widen `send` to match the interface (Claude applies model/effort at query creation, so per-send config is accepted but not re-applied here — the SDK reads model/effort at `query()` time; this is the SDK's granularity, surfaced honestly, not trux policy):

```ts
  send(text: string, attachments?: ImageAttachment[], _config?: TurnConfig): void {
    // _config is accepted for seam symmetry. Claude binds model/effort at query()
    // creation (see start), so a changed selection takes effect when the session is
    // next created — the SDK's own granularity, not a trux switch policy.
    // ...existing body unchanged...
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test -- claude`
Expected: PASS (3 cases). Then `pnpm --filter @trux/backend typecheck` — clean (all adapters now satisfy the seam).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/adapter/claude.ts apps/backend/src/adapter/claude.test.ts
git commit -m "feat(backend): Claude manifest (opus/sonnet/haiku + effort) and config routing into query()

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: DB migration — add `model`/`options` columns

**Files:**
- Modify: `apps/backend/src/db.ts`
- Create: `apps/backend/src/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openDb } from './db'

function columns(db: ReturnType<typeof openDb>): string[] {
  return (db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]).map((r) => r.name)
}

describe('conversations migration', () => {
  it('adds model and options columns', () => {
    const db = openDb(':memory:')
    const cols = columns(db)
    expect(cols).toContain('model')
    expect(cols).toContain('options')
  })

  it('is idempotent when columns already exist', () => {
    const db = openDb(':memory:')
    // Re-running the migration helper must not throw.
    expect(() => openDb(':memory:')).not.toThrow()
    expect(columns(db)).toContain('model')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/backend test -- db`
Expected: FAIL — `cols` lacks `model`/`options`.

- [ ] **Step 3: Add a forward-only migration helper**

In `apps/backend/src/db.ts`, add a helper and call it in `openDb` after `db.exec(SCHEMA)`:

```ts
// Forward-only column adds. SQLite has no portable ADD COLUMN IF NOT EXISTS, so
// check PRAGMA table_info first. Keep each add idempotent and ordered.
function migrate(db: TruxDatabase): void {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]).map((r) => r.name),
  )
  if (!cols.has('model')) db.exec('ALTER TABLE conversations ADD COLUMN model TEXT')
  if (!cols.has('options')) db.exec("ALTER TABLE conversations ADD COLUMN options TEXT NOT NULL DEFAULT '{}'")
}
```

Then in `openDb`, after `db.exec(SCHEMA)`:

```ts
  db.exec(SCHEMA)
  migrate(db)
  return db
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test -- db`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db.ts apps/backend/src/db.test.ts
git commit -m "feat(backend): conversations migration adds model/options columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Registry — persist + read + update selection

**Files:**
- Modify: `apps/backend/src/registry.ts`
- Modify/Create: `apps/backend/src/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/backend/src/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { SqliteRegistry } from './registry'

describe('registry model/options persistence', () => {
  it('seeds model/options on create and reads them back', () => {
    const reg = new SqliteRegistry(openDb(':memory:'))
    const conv = reg.createConversation({
      agent: 'claude', cwd: '/x', model: 'claude-opus-4-8', options: { effort: 'high' },
    })
    expect(conv.model).toBe('claude-opus-4-8')
    expect(conv.options).toEqual({ effort: 'high' })
    const again = reg.getConversation(conv.id)
    expect(again?.model).toBe('claude-opus-4-8')
    expect(again?.options).toEqual({ effort: 'high' })
  })

  it('defaults to null model / empty options when unspecified', () => {
    const reg = new SqliteRegistry(openDb(':memory:'))
    const conv = reg.createConversation({ agent: 'claude', cwd: '/x' })
    expect(conv.model).toBeNull()
    expect(conv.options).toEqual({})
  })

  it('setConfig updates the last-used selection (sticky)', () => {
    const reg = new SqliteRegistry(openDb(':memory:'))
    const conv = reg.createConversation({ agent: 'claude', cwd: '/x' })
    reg.setConfig(conv.id, { model: 'claude-sonnet-4-6', options: { effort: 'low' } })
    const again = reg.getConversation(conv.id)
    expect(again?.model).toBe('claude-sonnet-4-6')
    expect(again?.options).toEqual({ effort: 'low' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/backend test -- registry`
Expected: FAIL — `ConversationRow` has no `model`/`options`; `setConfig` undefined.

- [ ] **Step 3: Update the row type + mapper**

In `apps/backend/src/registry.ts`, extend `ConversationRow` and `toConversation`:

```ts
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
  model: string | null
  options: string // JSON; '{}' default
}
```
```ts
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
    model: row.model,
    options: row.options ? (JSON.parse(row.options) as Record<string, string>) : {},
  }
}
```

- [ ] **Step 4: Seed on create + add `setConfig`**

Update `createConversation` to populate the new columns, and add `setConfig`. Import `TurnConfig`:

```ts
import type { AgentName, Conversation, ConversationStatus, CreateConversationRequest, ServerEvent, StoredEvent, TurnConfig } from '@trux/protocol'
```

In `createConversation`, set the row fields and the INSERT:

```ts
    const row: ConversationRow = {
      id: randomUUID(),
      agent: input.agent,
      cwd: input.cwd,
      title: input.title ?? null,
      status: 'idle',
      native_session_id: input.native_session_id ?? null,
      archived: 0,
      created_at: now,
      updated_at: now,
      model: input.model ?? null,
      options: JSON.stringify(input.options ?? {}),
    }
    this.db
      .prepare(
        `INSERT INTO conversations
         (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options)
         VALUES (@id, @agent, @cwd, @title, @status, @native_session_id, @archived, @created_at, @updated_at, @model, @options)`,
      )
      .run(row)
    return toConversation(row)
```

Add the method (place near other mutators):

```ts
  // Sticky last-used selection for a conversation. Pure UI memory — trux's own,
  // not a model-behavior decision.
  setConfig(id: string, config: TurnConfig): void {
    this.db
      .prepare('UPDATE conversations SET model = @model, options = @options, updated_at = @now WHERE id = @id')
      .run({ id, model: config.model ?? null, options: JSON.stringify(config.options ?? {}), now: Date.now() })
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test -- registry`
Expected: PASS (3 cases). Existing registry tests still pass (the `SELECT *` reads now include the new columns).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/registry.ts apps/backend/src/registry.test.ts
git commit -m "feat(backend): registry persists model/options; setConfig for sticky last-used

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Manager — capabilities() + thread config through

**Files:**
- Modify: `apps/backend/src/manager.ts`
- Modify/Create: `apps/backend/src/manager.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/backend/src/manager.test.ts`. Use a fake adapter that records the config passed to `start`/`send`:

```ts
import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { SqliteRegistry } from './registry'
import { ConversationManager } from './manager'
import type { AgentAdapter, AgentSession } from './adapter/types'
import type { AgentCapabilities, TurnConfig } from '@trux/protocol'

function fakeAdapter(name: 'claude'): { adapter: AgentAdapter; startConfigs: (TurnConfig | undefined)[] } {
  const startConfigs: (TurnConfig | undefined)[] = []
  const session: AgentSession = {
    send() {}, async *events() {} as any, async interrupt() {}, async close() {},
    nativeSessionId: () => null, respondApproval() {},
  } as unknown as AgentSession
  const adapter: AgentAdapter = {
    name,
    capabilities(): AgentCapabilities {
      return { agent: name, models: [{ value: 'm', label: 'M' }], defaultModel: null, controls: [] }
    },
    start({ config }) { startConfigs.push(config); return session },
  }
  return { adapter, startConfigs }
}

describe('manager capabilities + config threading', () => {
  it('aggregates adapter manifests', () => {
    const { adapter } = fakeAdapter('claude')
    const reg = new SqliteRegistry(openDb(':memory:'))
    const mgr = new ConversationManager(reg, new Map([['claude', adapter]]), null as any)
    const caps = mgr.capabilities()
    expect(caps).toHaveLength(1)
    expect(caps[0].agent).toBe('claude')
  })

  it('persists per-turn config and passes it to the session at start', async () => {
    const { adapter, startConfigs } = fakeAdapter('claude')
    const reg = new SqliteRegistry(openDb(':memory:'))
    const mgr = new ConversationManager(reg, new Map([['claude', adapter]]), null as any)
    const conv = reg.createConversation({ agent: 'claude', cwd: '/x' })
    await mgr.handleUserMessage(conv.id, 'hi', undefined, undefined, { model: 'm', options: { effort: 'high' } })
    expect(reg.getConversation(conv.id)?.model).toBe('m')
    expect(startConfigs[0]).toEqual({ model: 'm', options: { effort: 'high' } })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/backend test -- manager`
Expected: FAIL — `mgr.capabilities` undefined; `handleUserMessage` arity/config not handled.

- [ ] **Step 3: Add `capabilities()`**

In `apps/backend/src/manager.ts`, add (near `availableAgents`, ~line 84):

```ts
  capabilities(): import('@trux/protocol').AgentCapabilities[] {
    return [...this.adapters.values()].map((a) => a.capabilities())
  }
```

- [ ] **Step 4: Thread `config` through `handleUserMessage`**

Update the signature and body. Add `config?: TurnConfig` as the last param; persist it (sticky) before ensuring the session; pass to `session.send`. Import `TurnConfig`:

```ts
import type { ImageAttachment, TurnConfig } from '@trux/protocol'
```
```ts
  async handleUserMessage(
    convId: string,
    text: string,
    attachments?: ImageAttachment[],
    clientMessageId?: string,
    config?: TurnConfig,
  ): Promise<void> {
    // Persist the selection first (sticky) so ensureSession reads the latest one.
    if (config) this.registry.setConfig(convId, config)
    const live = this.ensureSession(convId)
    // ...unchanged guard + idempotency + emits...
    live.session.send(text, attachments, config)
  }
```

- [ ] **Step 5: Feed the stored config into `ensureSession.start`**

In `ensureSession` (~line 178), build a `TurnConfig` from the persisted conversation and pass it:

```ts
    const session = adapter.start({
      cwd: conv.cwd,
      resume: conv.native_session_id ?? undefined,
      config: { model: conv.model, options: conv.options },
    })
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test -- manager`
Expected: PASS (2 cases). Existing manager tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/manager.ts apps/backend/src/manager.test.ts
git commit -m "feat(backend): manager aggregates manifests; threads sticky config into start/send

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Routes + stream — expose manifests, accept config

**Files:**
- Modify: `apps/backend/src/routes.ts`
- Modify: `apps/backend/src/server.ts`
- Modify: `apps/backend/src/stream.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/backend/src/routes.test.ts` (or create it; use the existing server-build test harness if present). Minimal direct test via the registry + a thin manifest check:

```ts
import { describe, it, expect } from 'vitest'
import { openDb } from './db'
import { SqliteRegistry } from './registry'

// /agents now returns manifests, and create accepts model/options. We assert the
// registry contract the route depends on; the route wiring is covered by typecheck
// + the build smoke below.
describe('create accepts model/options', () => {
  it('persists a selection passed at create time', () => {
    const reg = new SqliteRegistry(openDb(':memory:'))
    const conv = reg.createConversation({ agent: 'claude', cwd: '/x', model: 'claude-opus-4-8', options: { effort: 'high' } })
    expect(conv.model).toBe('claude-opus-4-8')
  })
})
```

- [ ] **Step 2: Run it to verify it passes the registry part, then wire routes**

Run: `pnpm --filter @trux/backend test -- routes`
Expected: PASS (registry contract). Now wire the routes (the behavior change is verified by the build smoke in Task 9/Task 10 and by typecheck here).

- [ ] **Step 3: `/agents` returns manifests**

`registerRoutes` currently receives `agents: AgentName[]`. Change it to receive `AgentCapabilities[]`. In `apps/backend/src/server.ts`, update the call:

```ts
    registerRoutes(scope, config, registry, manager.capabilities())
```

In `apps/backend/src/routes.ts`, update the `registerRoutes` signature and the two usages:

```ts
import type { AgentCapabilities, AgentName, ConversationDetail, CreateConversationRequest, DiscoveredSession } from '@trux/protocol'
```
```ts
export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
  agents: AgentCapabilities[],
): void {
```

`/agents` (was `({ agents })` over names) now already returns the right shape:

```ts
  app.get('/agents', async () => ({ agents }))
```

Update the create validation + body pass-through (the old `agents.includes(body.agent)` becomes a manifest lookup):

```ts
  app.post('/conversations', async (req, reply) => {
    const body = req.body as CreateConversationRequest
    if (!body || typeof body.cwd !== 'string' || body.cwd.length === 0) {
      return reply.code(400).send({ error: 'cwd is required' })
    }
    if (!agents.some((a) => a.agent === body.agent)) {
      return reply.code(400).send({ error: `unknown agent: ${body.agent}` })
    }
    return registry.createConversation({
      agent: body.agent,
      cwd: body.cwd,
      title: body.title,
      native_session_id: body.native_session_id,
      model: body.model ?? null,
      options: body.options ?? {},
    })
  })
```

Also update the session-discovery validation that used the agents list, if it referenced `agents.includes` (search the file; the discovery route checks `agent === 'claude'` literals, so no change needed there).

- [ ] **Step 4: Pass `config` through the stream**

In `apps/backend/src/stream.ts:58`, add `msg.config`:

```ts
        if (msg.type === 'user_message') {
          void manager.handleUserMessage(id, msg.text, msg.attachments, msg.client_message_id, msg.config)
```

- [ ] **Step 5: Typecheck + tests green**

Run: `pnpm --filter @trux/backend typecheck && pnpm --filter @trux/backend test`
Expected: clean typecheck; all backend tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/routes.ts apps/backend/src/server.ts apps/backend/src/stream.ts apps/backend/src/routes.test.ts
git commit -m "feat(backend): /agents serves manifests; create + stream carry config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Frontend API — manifests + config on create/send

**Files:**
- Modify: `apps/frontend/src/api.ts`
- Modify: `apps/frontend/src/connectionManager.ts`

- [ ] **Step 1: Update `createConversation` typing**

`api.ts` already types `listAgents` as `AgentsResponse` (now manifests — no code change, the type flows through). Ensure `createConversation` accepts the extended `CreateConversationRequest` (it already takes `CreateConversationRequest`, which now includes `model`/`options` — no change needed). Confirm by reading the file; if `createConversation` hardcodes a body shape, widen it to spread the request.

- [ ] **Step 2: Carry `config` on `sendUserMessage`**

In `apps/frontend/src/connectionManager.ts`, find `sendUserMessage(text, attachments, client_message_id)` and add an optional `config`:

```ts
  sendUserMessage(text: string, attachments?: ImageAttachment[], clientMessageId?: string, config?: TurnConfig): void {
    this.socket?.send(JSON.stringify({
      type: 'user_message',
      text,
      ...(attachments && attachments.length ? { attachments } : {}),
      ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      ...(config ? { config } : {}),
    }))
  }
```

Import `TurnConfig` (and `ImageAttachment` if not already) from `@trux/protocol`. Update the queued-flush call site (`connectionManager.ts:43`) to pass `m.config` if the local queue stores it; if the queue type doesn't carry config yet, leave the flush as-is (queued messages replay with their original config once Step in Task 11 stores it). Keep this minimal: add the param now; the composer wires it in Task 11.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @trux/frontend typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/api.ts apps/frontend/src/connectionManager.ts
git commit -m "feat(frontend): api/connection carry per-turn config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Frontend — generic `ControlPicker`

**Files:**
- Create: `apps/frontend/src/components/ControlPicker.tsx`
- Create: `apps/frontend/src/components/ControlPicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/ControlPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { AgentCapabilities, TurnConfig } from '@trux/protocol'
import { ControlPicker } from './ControlPicker'

const claude: AgentCapabilities = {
  agent: 'claude',
  models: [
    { value: 'claude-opus-4-8', label: 'Opus 4.8' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  ],
  defaultModel: null,
  controls: [
    { key: 'effort', label: 'Effort', options: [{ value: 'high', label: 'High' }], default: '' },
  ],
}

const empty: AgentCapabilities = { agent: 'codex', models: [], defaultModel: null, controls: [] }

describe('ControlPicker', () => {
  it('renders a model dropdown + one dropdown per control', () => {
    render(<ControlPicker caps={claude} value={{ model: null, options: {} }} onChange={() => {}} />)
    expect(screen.getByTestId('model-select')).toBeTruthy()
    expect(screen.getByTestId('control-effort')).toBeTruthy()
  })

  it('omits the model dropdown for an empty manifest', () => {
    render(<ControlPicker caps={empty} value={{ model: null, options: {} }} onChange={() => {}} />)
    expect(screen.queryByTestId('model-select')).toBeNull()
  })

  it('emits the selection on change', () => {
    const onChange = vi.fn()
    render(<ControlPicker caps={claude} value={{ model: null, options: {} }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-sonnet-4-6' } })
    expect(onChange).toHaveBeenCalledWith({ model: 'claude-sonnet-4-6', options: {} })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/frontend test -- ControlPicker`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the picker**

Create `apps/frontend/src/components/ControlPicker.tsx`:

```tsx
import type { AgentCapabilities, TurnConfig } from '@trux/protocol'

interface Props {
  caps: AgentCapabilities
  value: TurnConfig
  onChange: (next: TurnConfig) => void
}

// One generic renderer for any backend's manifest — the unification point.
// Model is first-class; every control is drawn the same way from the manifest.
// A leading "— default —" option (value '') means "no override": trux does not pick.
export function ControlPicker({ caps, value, onChange }: Props): React.ReactElement {
  const setModel = (model: string): void => onChange({ ...value, model: model || null })
  const setOption = (key: string, v: string): void => {
    const options = { ...value.options }
    if (v) options[key] = v
    else delete options[key]
    onChange({ ...value, options })
  }

  return (
    <div className="control-picker">
      {caps.models.length > 0 && (
        <select
          data-testid="model-select"
          value={value.model ?? ''}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">— default —</option>
          {caps.models.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      )}
      {caps.controls.map((c) => (
        <select
          key={c.key}
          data-testid={`control-${c.key}`}
          value={value.options[c.key] ?? ''}
          onChange={(e) => setOption(c.key, e.target.value)}
        >
          <option value="">{c.label}: default</option>
          {c.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/frontend test -- ControlPicker`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ControlPicker.tsx apps/frontend/src/components/ControlPicker.test.tsx
git commit -m "feat(frontend): generic ControlPicker renders any backend manifest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: New-conversation dialog uses the picker

**Files:**
- Modify: `apps/frontend/src/components/NewConversationDialog.tsx`

- [ ] **Step 1: Write the failing test**

Add `apps/frontend/src/components/NewConversationDialog.test.tsx` (or extend an existing one). Mock `api` so `listAgents` returns a manifest and assert the picker renders + create sends config:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewConversationDialog } from './NewConversationDialog'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    listWorkspaces: vi.fn().mockResolvedValue([{ name: 'repo', root: '/r', worktrees: [{ path: '/r', branch: 'main' }] }]),
    listAgents: vi.fn().mockResolvedValue({
      agents: [{ agent: 'claude', models: [{ value: 'claude-opus-4-8', label: 'Opus 4.8' }], defaultModel: null, controls: [] }],
    }),
    discoverSessions: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue({ id: 'c1' }),
  },
}))

describe('NewConversationDialog model picker', () => {
  beforeEach(() => vi.clearAllMocks())
  it('renders the model picker and sends the selection on create', async () => {
    render(<NewConversationDialog onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeTruthy())
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-opus-4-8' } })
    fireEvent.click(screen.getByTestId('create'))
    await waitFor(() =>
      expect(api.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'claude', model: 'claude-opus-4-8', options: {} }),
      ),
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/frontend test -- NewConversationDialog`
Expected: FAIL — no `model-select`; create called without `model`.

- [ ] **Step 3: Wire the picker into the dialog**

In `apps/frontend/src/components/NewConversationDialog.tsx`:
- change the agents state to manifests,
- track a `TurnConfig`,
- render `<ControlPicker>` for the selected agent,
- include `model`/`options` in `createConversation`.

```tsx
import { useEffect, useState } from 'react'
import type { AgentCapabilities, AgentName, DiscoveredSession, TurnConfig, Workspace } from '@trux/protocol'
import { api } from '../api'
import { ControlPicker } from './ControlPicker'
```

Replace the `agents` state and related logic:

```tsx
  const [agents, setAgents] = useState<AgentCapabilities[]>([])
  const [agent, setAgent] = useState<AgentName>('claude')
  const [config, setConfig] = useState<TurnConfig>({ model: null, options: {} })
```
```tsx
    void api.listAgents().then((r) => {
      const list = r.agents ?? []
      setAgents(list)
      if (list[0]) setAgent(list[0].agent)
    })
```

Reset config when the agent changes (so controls match the new manifest):

```tsx
  useEffect(() => {
    setConfig({ model: null, options: {} })
  }, [agent])
  const caps = agents.find((a) => a.agent === agent)
```

In the agent `<select>`, map manifests:

```tsx
      <select data-testid="agent-select" value={agent} onChange={(e) => setAgent(e.target.value as AgentName)}>
        {agents.map((a) => (
          <option key={a.agent} value={a.agent}>{a.agent}</option>
        ))}
      </select>
      {caps && <ControlPicker caps={caps} value={config} onChange={setConfig} />}
```

Update `create`:

```tsx
  const create = async (): Promise<void> => {
    if (!cwd) return
    const conv = await api.createConversation({
      agent,
      cwd,
      native_session_id: sessionId || undefined,
      model: config.model,
      options: config.options,
    })
    onCreated(conv.id)
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/frontend test -- NewConversationDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/NewConversationDialog.tsx apps/frontend/src/components/NewConversationDialog.test.tsx
git commit -m "feat(frontend): new-conversation dialog renders manifest picker, sends selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Composer — per-turn picker, sticky pre-fill

**Files:**
- Modify: `apps/frontend/src/components/ConversationView.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/src/components/ConversationView.test.tsx` (extend existing). Assert the composer shows the picker (seeded from the conversation's stored selection) and that sending passes the config. Use the existing ConversationView test harness; mock `api.listAgents` to return the claude manifest and render with a conversation whose `model` is set:

```tsx
// within the existing ConversationView test file, add:
it('composer shows the model picker seeded from the conversation and sends config', async () => {
  // Arrange a conversation detail with a sticky selection (model = sonnet).
  // (Use whatever fixtures/mocks the existing ConversationView tests use to
  //  provide a connection + conversation; set conversation.model to
  //  'claude-sonnet-4-6' and api.listAgents to the claude manifest.)
  // Assert:
  //  - screen.getByTestId('model-select') has value 'claude-sonnet-4-6'
  //  - sending a message calls client.sendUserMessage with a config arg whose
  //    model is 'claude-sonnet-4-6'
})
```

Replace the comment body with the concrete arrange/act/assert matching the file's existing harness (it already mounts `ConversationView` with a fake connection — reuse that fake and spy on its `sendUserMessage`).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/frontend test -- ConversationView`
Expected: FAIL — composer has no picker; send passes no config.

- [ ] **Step 3: Add the composer picker**

In `apps/frontend/src/components/ConversationView.tsx`:
- fetch the agent manifests (or accept them via props/store — match how the component currently gets data),
- hold a `TurnConfig` seeded from the conversation's `model`/`options`,
- render `<ControlPicker>` in the composer area,
- pass `config` to `sendUserMessage`.

```tsx
import type { AgentCapabilities, TurnConfig } from '@trux/protocol'
import { ControlPicker } from './ControlPicker'
```
```tsx
  const [agents, setAgents] = useState<AgentCapabilities[]>([])
  const [config, setConfig] = useState<TurnConfig>({
    model: conversation.model,
    options: conversation.options,
  })
  useEffect(() => { void api.listAgents().then((r) => setAgents(r.agents ?? [])) }, [])
  const caps = agents.find((a) => a.agent === conversation.agent)
```

In the composer JSX, above/beside the input, render the picker when the backend has controls:

```tsx
      {caps && (caps.models.length > 0 || caps.controls.length > 0) && (
        <ControlPicker caps={caps} value={config} onChange={setConfig} />
      )}
```

Update the send handler to pass config (find the existing `sendUserMessage(...)` call):

```tsx
    client.sendUserMessage(text, attachments, clientMessageId, config)
```

If the local outbox/queue persists messages for reconnect (see `connectionManager.ts:43`), store `config` alongside `text`/`attachments` so a replay re-sends the same selection. Add `config` to the queued-message shape and pass `m.config` in the flush loop.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/frontend test -- ConversationView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/ConversationView.tsx apps/frontend/src/connectionManager.ts
git commit -m "feat(frontend): per-turn composer picker, seeded from conversation; config on send

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Full green + finish the branch

**Files:** none (verification + integration).

- [ ] **Step 1: Full suite + typecheck**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all tests pass (the prior 201 plus the new cases), typecheck clean across all three packages.

- [ ] **Step 2: Production build smoke**

Run: `pnpm build`
Expected: frontend build succeeds (the new components compile into the bundle).

- [ ] **Step 3: Real-app smoke (optional but recommended)**

Run: `pnpm --filter frontend build && TRUX_WORKSPACES=$HOME pnpm start`, open `http://localhost:4317/`, create a Claude conversation, confirm the model + effort dropdowns appear and a prompt still streams. Stop with `pnpm stop`.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch to merge `feat/unified-model-controls` → `main` (merge when green), per the project's phase workflow.

---

## Self-Review

**Spec coverage:**
- Capability manifest (first-class model + opaque controls) → Task 1 (types), Task 3 (Claude), Task 2 (codex/opencode empty). ✓
- Per-turn selection `{model, options}` → Task 1 (`TurnConfig`, `UserMessageMessage.config`), Task 6/7 (threaded through manager/stream). ✓
- Adapter routing via native mechanism, no policy → Task 3 (model/effort into `query()` options; per-send config accepted but bound at query creation, surfaced honestly). ✓
- Sticky persistence → Task 4 (migration), Task 5 (registry persist + `setConfig`), Task 6 (`setConfig` on each turn; seed into `start`). ✓
- Unified UI renderer → Task 9 (`ControlPicker`), Task 10 (new-conversation), Task 11 (composer per-turn + sticky seed). ✓
- `/agents` serves manifests → Task 7. ✓
- Scope: Claude wired; codex/opencode empty manifests → Task 2/3; follow-up noted in spec. ✓
- Regression: 201 existing tests stay green → asserted in Task 7 Step 5 and Task 12. ✓

**Placeholder scan:** the only deliberately-templated spots are the two frontend test bodies in Task 11 Step 1 (they must adapt to the existing ConversationView test harness, which the engineer can read) — every other step has complete code. No TBD/TODO. The "default" sentinel (`''`/`null`) is fully specified, not a placeholder.

**Type/name consistency:** `AgentCapabilities` / `AgentControl` / `ControlOption` / `TurnConfig` are used identically across protocol (Task 1), seam (Task 2), Claude (Task 3), registry (Task 5), manager (Task 6), routes (Task 7), and the three frontend tasks. `setConfig(id, TurnConfig)` defined in Task 5, called in Task 6. `capabilities()` defined on the seam in Task 2, implemented in Tasks 2–3, aggregated in Task 6, served in Task 7. `ControlPicker` props (`caps`, `value`, `onChange`) defined in Task 9, consumed identically in Tasks 10–11. SDK option names (`model`, `effort` with `low|medium|high|xhigh|max`) match the verified `sdk.d.ts`. ✓
