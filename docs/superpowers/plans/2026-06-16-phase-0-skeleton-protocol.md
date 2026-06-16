# Phase 0 — Skeleton & Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the trux pnpm monorepo (`@trux/protocol`, `apps/backend`, `apps/frontend`) so the frontend connects to the backend over a WebSocket and a `hello` NCP message round-trips, running locally.

**Architecture:** A pnpm workspace with three packages. `@trux/protocol` holds the Normalized Conversation Protocol (NCP) types plus a runtime parser, exported directly as TypeScript source (no build step) and shared by both ends. The backend is Node + Fastify + `@fastify/websocket` + `better-sqlite3`, config from env, serving a `/conversations/:id/stream` WebSocket that validates the first `auth` frame and replies with a `hello` event. The frontend is React + Vite + Zustand; in dev, Vite proxies the WS to the backend so it stays same-origin. Both ends and tests transpile the shared protocol source via tsx / Vite / esbuild, so there is no protocol build ordering.

**Tech Stack:** pnpm 11 (via corepack) · TypeScript 6 (ESM, bundler resolution) · Node 22 · Fastify 5 + @fastify/websocket 11 + ws 8 · better-sqlite3 12 · React 19 + Vite 8 + Zustand 5 · Vitest 4 (+ happy-dom, @testing-library/react) · tsx for the dev runtime.

---

## File Structure

```
trux/
  package.json                      # root workspace manifest, scripts, packageManager, pnpm.onlyBuiltDependencies
  pnpm-workspace.yaml               # workspace globs
  tsconfig.base.json                # shared compiler options
  .npmrc                            # pnpm settings
  .gitignore
  packages/
    protocol/
      package.json                  # @trux/protocol — exports ./src/index.ts directly (no build)
      tsconfig.json
      vitest.config.ts
      src/
        index.ts                    # re-exports
        events.ts                   # NCP types (both directions) + PROTOCOL_VERSION
        parse.ts                    # parseClientMessage(raw) runtime validator
      test/
        parse.test.ts
  apps/
    backend/
      package.json                  # @trux/backend
      tsconfig.json
      vitest.config.ts
      src/
        config.ts                   # loadConfig() from env
        db.ts                        # openDb() + schema migration
        server.ts                    # buildServer(config, db) -> Fastify instance with WS route
        index.ts                     # entry: load env, open db, build + listen
      test/
        config.test.ts
        db.test.ts
        server.test.ts               # WS round-trip integration test
    frontend/
      package.json                  # @trux/frontend
      tsconfig.json
      vite.config.ts                 # react plugin, WS proxy, vitest config
      index.html
      src/
        main.tsx
        App.tsx
        truxClient.ts                # connectTrux() — testable WS client
      test/
        truxClient.test.ts
        App.test.tsx
```

**Responsibility boundaries:** `protocol` owns the wire contract and nothing else. `backend/config.ts`, `db.ts`, `server.ts` each own one concern (env, persistence, transport) and are composed only in `index.ts`. `frontend/truxClient.ts` owns all WS logic (testable with an injected socket); `App.tsx` only renders connection state.

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`, `.gitignore`

- [ ] **Step 1: Initialise git and activate pnpm via corepack**

Run:
```bash
cd /home/gp/dreamLand/jodulabs/trux
git init
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm -v
```
Expected: prints `11.7.0`.

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"

# pnpm 11 blocks lifecycle build scripts by default; better-sqlite3 (native) and esbuild need them.
onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
```

Note: in pnpm 10+/11 `onlyBuiltDependencies` lives in `pnpm-workspace.yaml`, **not** in `package.json` (the `pnpm.*` field in `package.json` is ignored with a warning).

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "trux",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

Note: `onlyBuiltDependencies` is configured in `pnpm-workspace.yaml` (Step 2), not here — pnpm 11 ignores the `pnpm.*` field in `package.json`.

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": [],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

- [ ] **Step 5: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
*.log
.trux/
*.db
*.db-shm
*.db-wal
.DS_Store
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo skeleton"
```

---

## Task 2: `@trux/protocol` — NCP types + parser

**Files:**
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`
- Create: `packages/protocol/src/events.ts`, `packages/protocol/src/parse.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/parse.test.ts`

- [ ] **Step 1: Create `packages/protocol/package.json`**

```json
{
  "name": "@trux/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

Note: `exports` points at the `.ts` source on purpose — tsx, Vite, and Vitest all transpile it, so consumers need no build step from this package.

- [ ] **Step 2: Create `packages/protocol/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/protocol/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create `packages/protocol/src/events.ts`** (the NCP — both directions)

```ts
// The Normalized Conversation Protocol (NCP). Carried over the WebSocket as JSON.
// This is the single contract the frontend renders and every adapter translates into.

export const PROTOCOL_VERSION = 1 as const

// ---- Shared ----
export type ConversationStatus = 'idle' | 'thinking' | 'awaiting_approval' | 'error'
export type ApprovalDecision = 'allow' | 'deny' | 'allow_always'
export type ToolResultStatus = 'ok' | 'error'

export interface ImageAttachment {
  kind: 'image'
  media_type: string
  data: string // base64
}

// ---- Server -> client (streamed) ----
export interface HelloEvent {
  type: 'hello'
  protocol_version: number
  server: string
}
export interface TurnStartedEvent {
  type: 'turn_started'
  turn_id: string
}
export interface TextDeltaEvent {
  type: 'text_delta'
  turn_id: string
  text: string
}
export interface TextEvent {
  type: 'text'
  turn_id: string
  text: string
}
export interface ToolCallEvent {
  type: 'tool_call'
  turn_id: string
  tool_id: string
  name: string
  input: unknown
}
export interface ToolResultEvent {
  type: 'tool_result'
  turn_id: string
  tool_id: string
  status: ToolResultStatus
  output: string
}
export interface ApprovalRequestEvent {
  type: 'approval_request'
  turn_id: string
  request_id: string
  tool: string
  input: unknown
  explanation?: string
}
export interface StatusEvent {
  type: 'status'
  state: ConversationStatus
}
export interface TurnCompleteEvent {
  type: 'turn_complete'
  turn_id: string
  usage?: { input: number; output: number }
  cost?: number | null
}
export interface ErrorEvent {
  type: 'error'
  message: string
  recoverable: boolean
}

export type ServerEvent =
  | HelloEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | StatusEvent
  | TurnCompleteEvent
  | ErrorEvent

// ---- Client -> server ----
export interface AuthMessage {
  type: 'auth'
  token: string
}
export interface UserMessageMessage {
  type: 'user_message'
  text: string
  attachments?: ImageAttachment[]
}
export interface ApprovalResponseMessage {
  type: 'approval_response'
  request_id: string
  decision: ApprovalDecision
  note?: string | null
}
export interface InterruptMessage {
  type: 'interrupt'
}

export type ClientMessage =
  | AuthMessage
  | UserMessageMessage
  | ApprovalResponseMessage
  | InterruptMessage
```

- [ ] **Step 5: Write the failing test `packages/protocol/test/parse.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { parseClientMessage } from '../src/parse'

describe('parseClientMessage', () => {
  it('parses a valid auth message', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'auth', token: 'abc' }))).toEqual({
      type: 'auth',
      token: 'abc',
    })
  })

  it('parses an interrupt message', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'interrupt' }))).toEqual({ type: 'interrupt' })
  })

  it('parses a user_message and drops unknown extra fields', () => {
    const out = parseClientMessage(JSON.stringify({ type: 'user_message', text: 'hi', extra: 1 }))
    expect(out).toEqual({ type: 'user_message', text: 'hi' })
  })

  it('parses an approval_response with a valid decision', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'approval_response', request_id: 'ap_1', decision: 'allow' })),
    ).toEqual({ type: 'approval_response', request_id: 'ap_1', decision: 'allow', note: null })
  })

  it('rejects an unknown type', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'nope' }))).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseClientMessage('{not json')).toBeNull()
  })

  it('rejects auth without a string token', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'auth' }))).toBeNull()
  })

  it('rejects approval_response with an invalid decision', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'approval_response', request_id: 'ap_1', decision: 'maybe' })),
    ).toBeNull()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @trux/protocol test`
Expected: FAIL — `parse.ts` / `parseClientMessage` does not exist.

- [ ] **Step 7: Create `packages/protocol/src/parse.ts`**

```ts
import type { ApprovalDecision, ClientMessage } from './events'

const DECISIONS: readonly ApprovalDecision[] = ['allow', 'deny', 'allow_always']

// Validate and narrow an untrusted inbound frame to a ClientMessage.
// Returns null on anything malformed — the WS boundary must never trust raw input.
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>

  switch (d.type) {
    case 'auth':
      return typeof d.token === 'string' ? { type: 'auth', token: d.token } : null
    case 'user_message':
      return typeof d.text === 'string' ? { type: 'user_message', text: d.text } : null
    case 'approval_response':
      if (typeof d.request_id !== 'string') return null
      if (!DECISIONS.includes(d.decision as ApprovalDecision)) return null
      return {
        type: 'approval_response',
        request_id: d.request_id,
        decision: d.decision as ApprovalDecision,
        note: typeof d.note === 'string' ? d.note : null,
      }
    case 'interrupt':
      return { type: 'interrupt' }
    default:
      return null
  }
}
```

- [ ] **Step 8: Create `packages/protocol/src/index.ts`**

```ts
export * from './events'
export * from './parse'
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @trux/protocol test`
Expected: PASS (8 tests).

- [ ] **Step 10: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): add NCP types and client message parser"
```

---

## Task 3: Backend config from env

**Files:**
- Create: `apps/backend/package.json`, `apps/backend/tsconfig.json`, `apps/backend/vitest.config.ts`
- Create: `apps/backend/src/config.ts`
- Test: `apps/backend/test/config.test.ts`

- [ ] **Step 1: Create `apps/backend/package.json`**

```json
{
  "name": "@trux/backend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@trux/protocol": "workspace:*",
    "@fastify/websocket": "^11.2.0",
    "better-sqlite3": "^12.11.1",
    "dotenv": "^17.4.2",
    "fastify": "^5.8.5",
    "ws": "^8.21.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.10.0",
    "@types/ws": "^8.18.1",
    "tsx": "^4.22.4"
  }
}
```

- [ ] **Step 2: Create `apps/backend/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `apps/backend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Install dependencies from the repo root**

Run: `pnpm install`
Expected: installs without error; `better-sqlite3` builds (it is in `onlyBuiltDependencies`).

- [ ] **Step 5: Write the failing test `apps/backend/test/config.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const KEYS = ['TRUX_HOST', 'TRUX_PORT', 'TRUX_DB_PATH', 'TRUX_SECRET', 'TRUX_AUTH']

describe('loadConfig', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults to a local, auth-optional config', () => {
    const config = loadConfig()
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4317)
    expect(config.authRequired).toBe(false)
    expect(config.secret).toBeNull()
    expect(config.dbPath).toMatch(/\.trux[/\\]trux\.db$/)
  })

  it('reads overrides from the environment', () => {
    process.env.TRUX_HOST = '0.0.0.0'
    process.env.TRUX_PORT = '5000'
    process.env.TRUX_DB_PATH = '/tmp/x.db'
    process.env.TRUX_SECRET = 's3cret'
    process.env.TRUX_AUTH = '1'
    const config = loadConfig()
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 5000,
      dbPath: '/tmp/x.db',
      secret: 's3cret',
      authRequired: true,
    })
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test`
Expected: FAIL — `config.ts` / `loadConfig` does not exist.

- [ ] **Step 7: Create `apps/backend/src/config.ts`**

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'

// 12-factor config: bind host/port, db path, secret, auth toggle — all from env.
// Local default binds loopback with auth optional (see design: Deployment & operations).
export interface Config {
  host: string
  port: number
  dbPath: string
  secret: string | null
  authRequired: boolean
}

function bool(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.TRUX_HOST ?? '127.0.0.1',
    port: env.TRUX_PORT ? Number(env.TRUX_PORT) : 4317,
    dbPath: env.TRUX_DB_PATH ?? join(homedir(), '.trux', 'trux.db'),
    secret: env.TRUX_SECRET ?? null,
    authRequired: bool(env.TRUX_AUTH),
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/backend package.json pnpm-lock.yaml
git commit -m "feat(backend): load 12-factor config from env"
```

---

## Task 4: Backend sqlite registry init

**Files:**
- Create: `apps/backend/src/db.ts`
- Test: `apps/backend/test/db.test.ts`

- [ ] **Step 1: Write the failing test `apps/backend/test/db.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db'

describe('openDb', () => {
  it('creates the conversations and events tables', () => {
    const db = openDb(':memory:')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toContain('conversations')
    expect(tables).toContain('events')
    db.close()
  })

  it('starts with zero conversations', () => {
    const db = openDb(':memory:')
    const { n } = db.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }
    expect(n).toBe(0)
    db.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test db`
Expected: FAIL — `db.ts` / `openDb` does not exist.

- [ ] **Step 3: Create `apps/backend/src/db.ts`**

```ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type TruxDatabase = Database.Database

// The ConversationRegistry store: a conversations table plus an append-only,
// ordered events table (the normalized transcript). Schema is created here so the
// box is ready for Phase 1; Phase 0 only proves init + round-trip.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id                 TEXT PRIMARY KEY,
  agent              TEXT NOT NULL,
  cwd                TEXT NOT NULL,
  title              TEXT,
  status             TEXT NOT NULL DEFAULT 'idle',
  native_session_id  TEXT,
  archived           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id),
  seq              INTEGER NOT NULL,
  type             TEXT NOT NULL,
  payload          TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_conversation
  ON events (conversation_id, seq);
`

export function openDb(path: string): TruxDatabase {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test db`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db.ts apps/backend/test/db.test.ts
git commit -m "feat(backend): init sqlite registry with conversation/event schema"
```

---

## Task 5: Backend server — WebSocket auth + hello round-trip

**Files:**
- Create: `apps/backend/src/server.ts`
- Test: `apps/backend/test/server.test.ts`

- [ ] **Step 1: Write the failing test `apps/backend/test/server.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import type { FastifyInstance } from 'fastify'
import type { ServerEvent } from '@trux/protocol'
import { buildServer } from '../src/server'
import { openDb, type TruxDatabase } from '../src/db'
import type { Config } from '../src/config'

const baseConfig: Config = {
  host: '127.0.0.1',
  port: 0,
  dbPath: ':memory:',
  secret: 'test-secret',
  authRequired: true,
}

let app: FastifyInstance
let db: TruxDatabase

async function listen(config: Config): Promise<number> {
  db = openDb(':memory:')
  app = await buildServer(config, db)
  await app.listen({ host: '127.0.0.1', port: 0 })
  return (app.server.address() as AddressInfo).port
}

// Open a WS, send the given first frame, resolve with the first server event received.
function firstEvent(port: number, firstFrame: unknown): Promise<ServerEvent> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/conversations/dev/stream`)
    ws.on('open', () => ws.send(JSON.stringify(firstFrame)))
    ws.on('message', (raw) => {
      resolve(JSON.parse(raw.toString()) as ServerEvent)
      ws.close()
    })
    ws.on('error', reject)
  })
}

afterEach(async () => {
  await app?.close()
  db?.close()
})

describe('buildServer websocket', () => {
  it('replies with a hello event after a valid auth frame', async () => {
    const port = await listen(baseConfig)
    const event = await firstEvent(port, { type: 'auth', token: 'test-secret' })
    expect(event).toEqual({ type: 'hello', protocol_version: 1, server: 'trux' })
  })

  it('rejects a wrong token with an error event', async () => {
    const port = await listen(baseConfig)
    const event = await firstEvent(port, { type: 'auth', token: 'wrong' })
    expect(event.type).toBe('error')
  })

  it('rejects a non-auth first frame with an error event', async () => {
    const port = await listen(baseConfig)
    const event = await firstEvent(port, { type: 'interrupt' })
    expect(event.type).toBe('error')
  })

  it('serves a health endpoint backed by the db', async () => {
    const port = await listen(baseConfig)
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, conversations: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @trux/backend test server`
Expected: FAIL — `server.ts` / `buildServer` does not exist.

- [ ] **Step 3: Create `apps/backend/src/server.ts`**

```ts
import { timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import { parseClientMessage, PROTOCOL_VERSION, type ServerEvent } from '@trux/protocol'
import type { Config } from './config'
import type { TruxDatabase } from './db'

function send(socket: WebSocket, event: ServerEvent): void {
  socket.send(JSON.stringify(event))
}

// Constant-time secret compare — the auth boundary is the RCE boundary (see design: Auth & security).
function tokenMatches(secret: string, token: string): boolean {
  const a = Buffer.from(secret)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function buildServer(config: Config, db: TruxDatabase): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)

  app.get('/health', async () => {
    const { n } = db.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }
    return { ok: true, conversations: n }
  })

  await app.register(async (scope) => {
    scope.get('/conversations/:id/stream', { websocket: true }, (socket) => {
      let authed = false
      // Handlers must be attached synchronously (per @fastify/websocket docs).
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
          const ok = config.authRequired
            ? config.secret !== null && tokenMatches(config.secret, msg.token)
            : true
          if (!ok) {
            send(socket, { type: 'error', message: 'unauthorized', recoverable: false })
            socket.close()
            return
          }
          authed = true
          send(socket, { type: 'hello', protocol_version: PROTOCOL_VERSION, server: 'trux' })
          return
        }

        // Authed but past hello: Phase 0 has no turn engine yet (Phase 1 wires the adapter).
        send(socket, { type: 'error', message: 'not implemented in phase 0', recoverable: true })
      })
    })
  })

  return app
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend test server`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full backend suite**

Run: `pnpm --filter @trux/backend test`
Expected: PASS (config + db + server tests).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/server.ts apps/backend/test/server.test.ts
git commit -m "feat(backend): WS stream with auth gate and hello round-trip"
```

---

## Task 6: Backend entry point

**Files:**
- Create: `apps/backend/src/index.ts`

- [ ] **Step 1: Create `apps/backend/src/index.ts`**

```ts
import 'dotenv/config'
import { loadConfig } from './config'
import { openDb } from './db'
import { buildServer } from './server'

async function main(): Promise<void> {
  const config = loadConfig()
  const db = openDb(config.dbPath)
  const app = await buildServer(config, db)
  await app.listen({ host: config.host, port: config.port })
  // eslint-disable-next-line no-console
  console.log(`trux backend listening on http://${config.host}:${config.port} (db: ${config.dbPath})`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Smoke-run the backend against a temp db**

Run:
```bash
TRUX_DB_PATH=/tmp/trux-smoke.db pnpm --filter @trux/backend start &
sleep 1
curl -s http://127.0.0.1:4317/health
kill %1
```
Expected: prints the listening line and `{"ok":true,"conversations":0}`.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(backend): wire entry point (config + db + listen)"
```

---

## Task 7: Frontend skeleton + WebSocket client

**Files:**
- Create: `apps/frontend/package.json`, `apps/frontend/tsconfig.json`, `apps/frontend/vite.config.ts`, `apps/frontend/index.html`
- Create: `apps/frontend/src/truxClient.ts`, `apps/frontend/src/App.tsx`, `apps/frontend/src/main.tsx`
- Test: `apps/frontend/test/truxClient.test.ts`, `apps/frontend/test/App.test.tsx`

- [ ] **Step 1: Create `apps/frontend/package.json`**

```json
{
  "name": "@trux/frontend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@trux/protocol": "workspace:*",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "happy-dom": "^20.10.4",
    "vite": "^8.0.16"
  }
}
```

- [ ] **Step 2: Create `apps/frontend/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `apps/frontend/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, proxy the WS stream to the backend so it stays same-origin (design: same-origin WS, no CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/conversations': {
        target: 'ws://127.0.0.1:4317',
        ws: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
```

- [ ] **Step 4: Create `apps/frontend/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Create `apps/frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Trux</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write the failing test `apps/frontend/test/truxClient.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ServerEvent } from '@trux/protocol'
import { connectTrux } from '../src/truxClient'

// Minimal fake of the browser WebSocket, enough to drive connectTrux in tests.
class FakeWebSocket {
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}
  constructor(public url: string) {}
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    ;(this.listeners[type] ??= []).push(fn)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {}
  emit(type: string, ev: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(ev)
  }
}

describe('connectTrux', () => {
  it('sends an auth frame on open', () => {
    let socket!: FakeWebSocket
    connectTrux({
      url: 'ws://x/stream',
      token: 'secret',
      WebSocketImpl: class extends FakeWebSocket {
        constructor(url: string) {
          super(url)
          socket = this
        }
      } as unknown as typeof WebSocket,
    })
    socket.emit('open', {})
    expect(socket.sent).toEqual([JSON.stringify({ type: 'auth', token: 'secret' })])
  })

  it('invokes onReady when a hello event arrives', () => {
    let socket!: FakeWebSocket
    const onReady = vi.fn()
    connectTrux({
      url: 'ws://x/stream',
      onReady,
      WebSocketImpl: class extends FakeWebSocket {
        constructor(url: string) {
          super(url)
          socket = this
        }
      } as unknown as typeof WebSocket,
    })
    const hello: ServerEvent = { type: 'hello', protocol_version: 1, server: 'trux' }
    socket.emit('message', { data: JSON.stringify(hello) })
    expect(onReady).toHaveBeenCalledWith(hello)
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @trux/frontend test truxClient`
Expected: FAIL — `truxClient.ts` / `connectTrux` does not exist.

- [ ] **Step 8: Create `apps/frontend/src/truxClient.ts`**

```ts
import type { ClientMessage, HelloEvent, ServerEvent } from '@trux/protocol'

export interface TruxClientOptions {
  url: string
  token?: string
  onEvent?: (event: ServerEvent) => void
  onReady?: (hello: HelloEvent) => void
  WebSocketImpl?: typeof WebSocket
}

export interface TruxClient {
  send: (msg: ClientMessage) => void
  close: () => void
}

// Open the WS, authenticate on connect, and surface normalized events.
export function connectTrux(opts: TruxClientOptions): TruxClient {
  const WS = opts.WebSocketImpl ?? WebSocket
  const ws = new WS(opts.url)

  ws.addEventListener('open', () => {
    const auth: ClientMessage = { type: 'auth', token: opts.token ?? '' }
    ws.send(JSON.stringify(auth))
  })

  ws.addEventListener('message', (ev: MessageEvent) => {
    let event: ServerEvent
    try {
      event = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerEvent
    } catch {
      return
    }
    if (event.type === 'hello') opts.onReady?.(event)
    opts.onEvent?.(event)
  })

  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => ws.close(),
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @trux/frontend test truxClient`
Expected: PASS (2 tests).

- [ ] **Step 10: Create `apps/frontend/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { connectTrux } from './truxClient'

type ConnState = { state: 'connecting' } | { state: 'connected'; protocol: number }

export function App(): React.ReactElement {
  const [conn, setConn] = useState<ConnState>({ state: 'connecting' })

  useEffect(() => {
    const client = connectTrux({
      url: `ws://${location.host}/conversations/dev/stream`,
      onReady: (hello) => setConn({ state: 'connected', protocol: hello.protocol_version }),
    })
    return () => client.close()
  }, [])

  return (
    <main>
      <h1>Trux</h1>
      <p data-testid="status">
        {conn.state === 'connected' ? `Connected — NCP v${conn.protocol}` : 'Connecting…'}
      </p>
    </main>
  )
}
```

- [ ] **Step 11: Write the failing test `apps/frontend/test/App.test.tsx`**

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from '../src/App'

// A no-op WebSocket so App mounts without a real network connection.
class NoopWebSocket {
  constructor(public url: string) {}
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

afterEach(cleanup)

describe('App', () => {
  it('renders the connecting state on mount', () => {
    vi.stubGlobal('WebSocket', NoopWebSocket)
    render(<App />)
    expect(screen.getByTestId('status')).toHaveTextContent('Connecting…')
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter @trux/frontend test App`
Expected: PASS (1 test). (App is already implemented; this test confirms the render contract.)

- [ ] **Step 13: Create `apps/frontend/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 14: Install new deps and run the full frontend suite**

Run:
```bash
pnpm install
pnpm --filter @trux/frontend test
```
Expected: PASS (truxClient + App tests).

- [ ] **Step 15: Commit**

```bash
git add apps/frontend pnpm-lock.yaml
git commit -m "feat(frontend): React+Vite skeleton with WS client and connection state"
```

---

## Task 8: End-to-end verification (the Phase 0 "done when")

**Files:** none (verification only).

- [ ] **Step 1: Typecheck and test the whole workspace**

Run:
```bash
pnpm -r typecheck
pnpm -r test
```
Expected: typecheck passes for all three packages; all tests pass.

- [ ] **Step 2: Run backend + frontend together**

Run (from repo root): `pnpm dev`
Expected: backend logs `trux backend listening on http://127.0.0.1:4317`; Vite logs a local URL (e.g. `http://localhost:5173`).

- [ ] **Step 3: Confirm the hello round-trip in the browser**

Open `http://localhost:5173`. Expected: the page shows **"Connected — NCP v1"** (the frontend opened the WS through the Vite proxy, sent `auth`, and received the `hello` event). With default local config `TRUX_AUTH` is unset, so the empty token is accepted.

- [ ] **Step 4: Stop the dev processes**

Press `Ctrl-C` in the `pnpm dev` terminal.

- [ ] **Step 5: Final commit (roadmap checkboxes)**

Update `docs/2026-06-16-trux-roadmap.md` Phase 0 — tick the four items and the "Done when" line, then:
```bash
git add docs/2026-06-16-trux-roadmap.md
git commit -m "docs: mark Phase 0 complete"
```

---

## Self-Review

**Spec coverage (roadmap Phase 0):**
- "pnpm monorepo: `packages/protocol`, `apps/backend`, `apps/frontend`" → Task 1 + package manifests in Tasks 2/3/7. ✅
- "`@trux/protocol` — the NCP types (events both directions), shared by backend + frontend" → Task 2 (`events.ts` both directions; imported by backend in Task 5 and frontend in Tasks 7). ✅
- "Backend skeleton: Node + Fastify, `ws` wired, `better-sqlite3` init, config from env" → Tasks 3 (config), 4 (sqlite), 5 (Fastify + @fastify/websocket), 6 (entry). ✅
- "Frontend skeleton: React + Vite, opens the WebSocket" → Task 7. ✅
- "Done when: frontend connects to backend, a hello NCP message round-trips, runs locally" → Task 5 (server hello), Task 7 (client), Task 8 (browser verification). ✅

**Design-spec touchpoints honored:** bearer-token first-WS-message with constant-time compare (Task 5); local default binds `127.0.0.1`, auth optional (Task 3); sqlite registry with conversations + ordered events tables (Task 4); same-origin WS via Vite proxy (Task 7); shared `@trux/protocol` types compile-checked both ends (Task 8 typecheck). The `hello` event is an additive Phase-0 handshake event (not in the design's streamed list) used to prove the round-trip; it does not conflict with the NCP.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step is complete.

**Type consistency:** `Config`, `TruxDatabase`, `buildServer(config, db)`, `parseClientMessage`, `PROTOCOL_VERSION`, `ServerEvent`/`ClientMessage`/`HelloEvent`, `connectTrux`/`TruxClient` are defined once and referenced with identical signatures across tasks. The `/health` shape `{ ok, conversations }` matches between Task 5 implementation and test, and Task 6 smoke test.
