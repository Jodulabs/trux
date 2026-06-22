# Authenticator Phase 1 — Framework + Codex Subscription Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Per the user's standing preference this plan is **lean** — implement directly, keep existing suites green, add unit tests for the pure logic (stdout parsing, status mapping, the REST auth gate) and an integration/render gate for the screen, but skip the write-failing-test-first ceremony.

**Goal:** Ship the `Authenticator` registry + a phone "Connections" screen + **Codex subscription login working end-to-end** (`codex login --device-auth`, relayed to the phone) with its **API-key fallback** (`codex login --with-api-key`), proving the relay, the status lifecycle, and model-plane credential delivery.

**Architecture:** Mirror the agent-adapter pattern — an `Authenticator` interface, one adapter per provider, a `Map<string, Authenticator>` built in `index.ts` and threaded through `buildServer` into bearer-gated REST routes `/auth/:provider/{begin,poll,status,disconnect,key}`. The Codex adapter spawns the CLI (injectable `SpawnFn` seam, exactly like `terminal.ts`/`adapter/codex.ts`), scrapes the verify-URL + user-code from stdout, and reports `connected` once the child exits 0 (the CLI does the device-code polling internally and writes `~/.codex/auth.json`). The spine gets an `./auth` client; the phone gets a Connections screen reachable from the list header.

**Tech Stack:** Fastify (bearer preHandler scope), Node `child_process.spawn` (CLI orchestration), the `@trux/client` ports (token + httpBase), expo-router (Connections screen), Vitest.

**Scope (Phase 1 only):** Codex device-login + key fallback, the registry, the screen. **Out:** Claude/opencode adapters, machine providers (Fly/GCP), expiry/refresh automation, encryption-at-rest — all Phase 2 (see spec). The findings note (`docs/superpowers/specs/2026-06-22-authenticator-phase0-findings.md`) governs the mechanics.

**Branch / workspace:** a git **worktree** on `feat/authenticator-phase1` (the user works in worktrees, not direct branches).

---

## Findings-note caveats carried into this plan

1. **Login subcommands are destructive.** `codex login --device-auth` rewrites/clears `~/.codex/auth.json` the instant it starts — so `begin()` invalidates any current session. The Connections screen must confirm before re-auth of a connected provider (Task 6, Step 2).
2. **Env key shadows OAuth.** A present `ANTHROPIC_API_KEY` shadows the Claude OAuth store — irrelevant to Codex (Phase 1) but the reason `status()` returns the live state from the CLI itself rather than assuming the cred file. (Carried for Phase 2.)
3. **The CLI owns polling + refresh.** trux does not poll a provider endpoint; it watches the child process and `codex login status`. No OAuth re-implementation.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/backend/src/auth-provider.ts` | create | `Authenticator` interface, `AuthMode`/`AuthStatus` types, pure `parseCodexDeviceOutput` + `parseCodexStatus` helpers |
| `apps/backend/src/auth-codex.ts` | create | `CodexAuthenticator` — `SpawnFn` seam, `begin/poll/status/submitKey/disconnect` orchestrating the `codex` CLI |
| `apps/backend/src/auth-codex.test.ts` | create | unit: parse device output / status, begin→poll lifecycle, key fallback, disconnect — all via a fake spawn |
| `apps/backend/src/auth-route.ts` | create | `registerAuth(scope, config, authenticators)` — bearer-gated REST `begin/poll/status/disconnect/key` |
| `apps/backend/src/auth-route.test.ts` | create | unit: unknown provider 400, begin/poll/status/disconnect/key happy paths via a fake `Authenticator` |
| `apps/backend/src/server.ts` | modify | thread `authenticators`, call `registerAuth` inside the existing bearer scope |
| `apps/backend/src/index.ts` | modify | build the `Map<string, Authenticator>` and pass it to `buildServer` |
| `packages/client/src/auth.ts` | create | `authApi` — `begin/poll/status/disconnect/submitKey` over authenticated fetch |
| `packages/client/src/auth.test.ts` | create | URL/shape + token header |
| `packages/client/package.json` | modify | add the `./auth` subpath export |
| `apps/mobile/app/(app)/connections.tsx` | create | the Connections screen (provider list, begin → show URL+code, key fallback, status) |
| `apps/mobile/app/(app)/index.tsx` | modify | a header button → `router.push('/connections')` |

---

## Task 1: Authenticator interface + pure parsers

**Files:** Create `apps/backend/src/auth-provider.ts`, `apps/backend/src/auth-codex.test.ts` (parser tests first portion).

- [ ] **Step 1:** Create `apps/backend/src/auth-provider.ts` — the shared contract (mirrors `adapter/types.ts` style) plus the two pure parsers Codex needs. Keep parsers here so they're trivially unit-testable without spawning anything.

```ts
// The phone-facing auth contract. One adapter per provider, surfaced as the
// "Connections" screen. Mirrors the AgentAdapter registry pattern.
export type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string | null } // relay URL→phone; box watches the CLI
  | { mode: 'apikey'; label: string } // secondary: paste a key, box stores via the CLI
export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'expired'

export interface Authenticator {
  readonly id: string // 'codex' | 'claude' | 'opencode' | 'fly' | …
  readonly plane: 'model' | 'machine' // decides where the credential lands
  begin(): Promise<AuthMode>
  poll(): Promise<AuthStatus> // device flow: box watches the CLI's progress
  status(): Promise<AuthStatus>
  disconnect(): Promise<void>
  submitKey?(key: string): Promise<AuthStatus> // the key fallback
}

// `codex login --device-auth` prints a verification URL and a user code, then
// blocks until the user completes login in their browser. Scrape both from a
// chunk of stdout. URL: first https URL on a line; code: a short A-Z0-9(-) token
// near a "code" label. Returns null until the URL has appeared.
export function parseCodexDeviceOutput(buf: string): { verifyUrl: string; userCode: string | null } | null {
  const urlMatch = /(https?:\/\/[^\s]+)/.exec(buf)
  if (!urlMatch) return null
  const verifyUrl = urlMatch[1].replace(/[).,]+$/, '') // strip trailing punctuation
  const codeMatch = /code[^A-Z0-9]*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})?)/i.exec(buf)
  return { verifyUrl, userCode: codeMatch ? codeMatch[1] : null }
}

// `codex login status` prints "Logged in using ChatGPT" when authed, and a
// "Not logged in" line otherwise.
export function parseCodexStatus(out: string): AuthStatus {
  return /logged in/i.test(out) && !/not logged in/i.test(out) ? 'connected' : 'disconnected'
}
```

- [ ] **Step 2:** Create `apps/backend/src/auth-codex.test.ts` with just the parser tests for now (the spawn-based tests come in Task 2):

```ts
import { describe, it, expect } from 'vitest'
import { parseCodexDeviceOutput, parseCodexStatus } from './auth-provider'

describe('parseCodexDeviceOutput', () => {
  it('extracts the verify URL and user code', () => {
    const out = 'To authenticate, visit https://chatgpt.com/device and enter code: WXYZ-1234\n'
    expect(parseCodexDeviceOutput(out)).toEqual({ verifyUrl: 'https://chatgpt.com/device', userCode: 'WXYZ-1234' })
  })
  it('returns the URL with a null code when no code is present', () => {
    expect(parseCodexDeviceOutput('Open https://example.com/auth to continue')).toEqual({
      verifyUrl: 'https://example.com/auth',
      userCode: null,
    })
  })
  it('returns null before any URL appears', () => {
    expect(parseCodexDeviceOutput('Starting device authorization…')).toBeNull()
  })
})

describe('parseCodexStatus', () => {
  it('maps a logged-in line to connected', () => {
    expect(parseCodexStatus('Logged in using ChatGPT')).toBe('connected')
  })
  it('maps a not-logged-in line to disconnected', () => {
    expect(parseCodexStatus('Not logged in')).toBe('disconnected')
  })
})
```

- [ ] **Step 3:** Run the parser tests:

```bash
pnpm --filter @trux/backend exec vitest run src/auth-codex.test.ts
```
Expected: PASS (5 assertions).

- [ ] **Step 4:** Commit.

```bash
git add apps/backend/src/auth-provider.ts apps/backend/src/auth-codex.test.ts && git commit -m "feat(backend): Authenticator interface + codex stdout parsers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: CodexAuthenticator (CLI orchestration via injectable spawn)

**Files:** Create `apps/backend/src/auth-codex.ts`; extend `apps/backend/src/auth-codex.test.ts`.

The CLI does the device-code polling itself, so the adapter's job is: spawn `codex login --device-auth`, hold the child, scrape stdout for the URL/code (resolve `begin()` once seen), and report `connected` when the child exits 0. `poll()` reflects the held child's state; `status()` shells `codex login status`; `submitKey()` pipes the key to `codex login --with-api-key`; `disconnect()` runs `codex logout`.

- [ ] **Step 1:** Create `apps/backend/src/auth-codex.ts`. The `SpawnFn` seam mirrors `adapter/codex.ts:13-16` so tests inject a fake child.

```ts
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'
import { parseCodexDeviceOutput, parseCodexStatus } from './auth-provider'

// Injectable child seam (mirrors adapter/codex.ts SpawnFn + terminal.ts SpawnPty).
export interface AuthChild extends EventEmitter {
  readonly stdout: EventEmitter
  readonly stderr: EventEmitter
  readonly stdin: { write(s: string): void; end(): void }
  kill(signal?: string): boolean
}
export type SpawnFn = (cmd: string, args: string[]) => AuthChild

const defaultSpawn: SpawnFn = (cmd, args) => spawn(cmd, args) as unknown as AuthChild

export class CodexAuthenticator implements Authenticator {
  readonly id = 'codex'
  readonly plane = 'model' as const

  // The in-flight device-login child + the status it has reached. Only one login
  // runs at a time; a new begin() kills any prior child (the CLI clears auth.json
  // on start anyway — see the findings note).
  private child: AuthChild | null = null
  private deviceStatus: AuthStatus = 'disconnected'

  constructor(private readonly spawnFn: SpawnFn = defaultSpawn) {}

  begin(): Promise<AuthMode> {
    this.child?.kill()
    const child = this.spawnFn('codex', ['login', '--device-auth'])
    this.child = child
    this.deviceStatus = 'pending'
    let buf = ''
    return new Promise<AuthMode>((resolve, reject) => {
      let settled = false
      const onData = (d: Buffer): void => {
        buf += d.toString()
        const parsed = parseCodexDeviceOutput(buf)
        if (parsed && !settled) {
          settled = true
          resolve({ mode: 'device', verifyUrl: parsed.verifyUrl, userCode: parsed.userCode })
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData) // some CLIs print the URL to stderr
      child.on('exit', (code: number) => {
        this.deviceStatus = code === 0 ? 'connected' : 'disconnected'
        this.child = null
        if (!settled) {
          settled = true
          reject(new Error('codex login exited before printing a verification URL'))
        }
      })
    })
  }

  // The held child reports progress: pending while it runs, connected/disconnected
  // once it exits. Falls back to the persisted status when no login is in flight.
  async poll(): Promise<AuthStatus> {
    if (this.child) return 'pending'
    return this.deviceStatus === 'connected' ? 'connected' : this.status()
  }

  status(): Promise<AuthStatus> {
    return this.run(['login', 'status']).then((out) => parseCodexStatus(out)).catch(() => 'disconnected')
  }

  submitKey(key: string): Promise<AuthStatus> {
    return new Promise<AuthStatus>((resolve) => {
      const child = this.spawnFn('codex', ['login', '--with-api-key'])
      child.on('exit', (code: number) => resolve(code === 0 ? 'connected' : 'disconnected'))
      child.stdin.write(key.trim() + '\n')
      child.stdin.end()
    })
  }

  async disconnect(): Promise<void> {
    this.child?.kill()
    this.child = null
    this.deviceStatus = 'disconnected'
    await this.run(['logout']).catch(() => undefined)
  }

  // Run a codex subcommand to completion, collecting stdout.
  private run(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnFn('codex', args)
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('exit', (code: number) => (code === 0 ? resolve(out) : reject(new Error(`codex ${args.join(' ')} exited ${code}`))))
    })
  }
}
```

- [ ] **Step 2:** Extend `apps/backend/src/auth-codex.test.ts` with a fake child + lifecycle tests. Append:

```ts
import { EventEmitter } from 'node:events'
import { CodexAuthenticator, type AuthChild, type SpawnFn } from './auth-codex'

function fakeChild(): AuthChild & { emitOut(s: string): void; emitExit(code: number): void } {
  const ee = new EventEmitter() as AuthChild & { emitOut(s: string): void; emitExit(code: number): void }
  Object.defineProperty(ee, 'stdout', { value: new EventEmitter() })
  Object.defineProperty(ee, 'stderr', { value: new EventEmitter() })
  Object.defineProperty(ee, 'stdin', { value: { write: () => {}, end: () => {} } })
  ee.kill = () => true
  ee.emitOut = (s) => (ee.stdout as EventEmitter).emit('data', Buffer.from(s))
  ee.emitExit = (code) => ee.emit('exit', code)
  return ee
}

describe('CodexAuthenticator', () => {
  it('begin() resolves with the device URL+code once stdout prints them', async () => {
    const child = fakeChild()
    const spawnFn: SpawnFn = () => child
    const auth = new CodexAuthenticator(spawnFn)
    const p = auth.begin()
    child.emitOut('Visit https://chatgpt.com/device and enter code: ABCD-7788')
    await expect(p).resolves.toEqual({ mode: 'device', verifyUrl: 'https://chatgpt.com/device', userCode: 'ABCD-7788' })
  })

  it('poll() is pending while the child runs, connected after exit 0', async () => {
    const child = fakeChild()
    const auth = new CodexAuthenticator(() => child)
    const p = auth.begin()
    child.emitOut('Visit https://chatgpt.com/device code: ABCD-7788')
    await p
    expect(await auth.poll()).toBe('pending')
    child.emitExit(0)
    expect(await auth.poll()).toBe('connected')
  })

  it('submitKey() pipes the key and maps exit 0 to connected', async () => {
    let written = ''
    const child = fakeChild()
    Object.defineProperty(child, 'stdin', { value: { write: (s: string) => (written = s), end: () => {} } })
    const auth = new CodexAuthenticator(() => child)
    const p = auth.submitKey('sk-test-123')
    child.emitExit(0)
    expect(await p).toBe('connected')
    expect(written).toContain('sk-test-123')
  })
})
```

- [ ] **Step 3:** Run the full file:

```bash
pnpm --filter @trux/backend exec vitest run src/auth-codex.test.ts
```
Expected: PASS (8 assertions).

- [ ] **Step 4:** Commit.

```bash
git add apps/backend/src/auth-codex.ts apps/backend/src/auth-codex.test.ts && git commit -m "feat(backend): CodexAuthenticator — device login + key fallback over the codex CLI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: REST routes (bearer-gated)

**Files:** Create `apps/backend/src/auth-route.ts`, `apps/backend/src/auth-route.test.ts`.

These mount inside the same encapsulated scope as `registerRoutes`, so the bearer `preHandler` (`routes.ts:110-118`) already protects them. `registerAuth` therefore takes the `scope`, not the root `app`.

- [ ] **Step 1:** Create `apps/backend/src/auth-route.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import type { Config } from './config'
import type { Authenticator } from './auth-provider'

// Registered INSIDE the bearer-gated REST scope (server.ts) — the preHandler in
// registerRoutes already rejects unauthorized requests, so no extra auth here.
// `config` is unused today but kept in the signature to match the route family
// and for Phase 2 (per-provider policy).
export function registerAuth(
  app: FastifyInstance,
  _config: Config,
  authenticators: Map<string, Authenticator>,
): void {
  const find = (id: string): Authenticator | undefined => authenticators.get(id)

  app.get('/auth/providers', async () =>
    [...authenticators.values()].map((a) => ({ id: a.id, plane: a.plane })),
  )

  app.post('/auth/:provider/begin', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    return a.begin()
  })

  app.get('/auth/:provider/poll', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    return { status: await a.poll() }
  })

  app.get('/auth/:provider/status', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    return { status: await a.status() }
  })

  app.post('/auth/:provider/disconnect', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    await a.disconnect()
    return { status: 'disconnected' as const }
  })

  app.post('/auth/:provider/key', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    if (!a.submitKey) return reply.code(400).send({ error: 'provider has no key fallback' })
    const body = req.body as { key?: string }
    if (!body || typeof body.key !== 'string' || body.key.length === 0) {
      return reply.code(400).send({ error: 'key is required' })
    }
    return { status: await a.submitKey(body.key) }
  })
}
```

- [ ] **Step 2:** Create `apps/backend/src/auth-route.test.ts` — drive the routes with a Fastify instance + a fake authenticator (no CLI). Model the auth-gate assertion on how other route tests build the app (check an existing `*-route.test.ts` or `routes` test for the exact bootstrap; the snippet below is the standard Fastify `inject` shape):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from './auth-route'
import type { Authenticator, AuthMode, AuthStatus } from './auth-provider'
import type { Config } from './config'

const config = { authRequired: false, secret: null } as unknown as Config

class FakeAuth implements Authenticator {
  readonly id = 'codex'
  readonly plane = 'model' as const
  begun = false
  begin(): Promise<AuthMode> {
    this.begun = true
    return Promise.resolve({ mode: 'device', verifyUrl: 'https://x/dev', userCode: 'AAAA-1111' })
  }
  poll(): Promise<AuthStatus> { return Promise.resolve('pending') }
  status(): Promise<AuthStatus> { return Promise.resolve('connected') }
  disconnect(): Promise<void> { return Promise.resolve() }
  submitKey(key: string): Promise<AuthStatus> { return Promise.resolve(key === 'good' ? 'connected' : 'disconnected') }
}

let app: FastifyInstance
let fake: FakeAuth
beforeEach(async () => {
  app = Fastify()
  fake = new FakeAuth()
  registerAuth(app, config, new Map<string, Authenticator>([['codex', fake]]))
  await app.ready()
})

describe('auth routes', () => {
  it('begin returns the device mode', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/codex/begin' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ mode: 'device', verifyUrl: 'https://x/dev', userCode: 'AAAA-1111' })
    expect(fake.begun).toBe(true)
  })
  it('unknown provider is 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/nope/begin' })
    expect(res.statusCode).toBe(400)
  })
  it('poll/status return the lifecycle status', async () => {
    expect((await app.inject({ method: 'GET', url: '/auth/codex/poll' })).json()).toEqual({ status: 'pending' })
    expect((await app.inject({ method: 'GET', url: '/auth/codex/status' })).json()).toEqual({ status: 'connected' })
  })
  it('key fallback validates and maps the result', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/codex/key', payload: { key: 'good' } })).json()).toEqual({ status: 'connected' })
    expect((await app.inject({ method: 'POST', url: '/auth/codex/key', payload: {} })).statusCode).toBe(400)
  })
})
```

- [ ] **Step 3:** Run:

```bash
pnpm --filter @trux/backend exec vitest run src/auth-route.test.ts
```
Expected: PASS.

- [ ] **Step 4:** Commit.

```bash
git add apps/backend/src/auth-route.ts apps/backend/src/auth-route.test.ts && git commit -m "feat(backend): /auth/:provider REST routes (begin/poll/status/disconnect/key)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire into the server

**Files:** Modify `apps/backend/src/server.ts`, `apps/backend/src/index.ts`.

- [ ] **Step 1:** In `apps/backend/src/server.ts`, import the route + type and thread an `authenticators` param. Add the import near the others (after line 14):

```ts
import { registerAuth } from './auth-route'
import type { Authenticator } from './auth-provider'
```

Change the `buildServer` signature to accept the map (extend the `opts` object so existing call sites stay valid — but index.ts will pass it):

```ts
export async function buildServer(
  config: Config,
  db: TruxDatabase,
  registry: SqliteRegistry,
  manager: ConversationManager,
  opts?: { vapidPublicKey?: string | null; authenticators?: Map<string, Authenticator> },
): Promise<FastifyInstance> {
```

Inside the existing bearer scope (currently lines 40-42), add the `registerAuth` call so it inherits the preHandler:

```ts
  await app.register(async (scope) => {
    registerRoutes(scope, config, registry, manager.capabilities())
    if (opts?.authenticators) registerAuth(scope, config, opts.authenticators)
  })
```

- [ ] **Step 2:** In `apps/backend/src/index.ts`, build the map and pass it. Add imports (after line 8):

```ts
import { CodexAuthenticator } from './auth-codex'
import type { Authenticator } from './auth-provider'
```

After the `adapters` map (line 29), add:

```ts
  // Phase 1: only Codex (cleanest headless device flow — see the Phase 0 findings).
  // Claude/opencode/machine providers follow in Phase 2 behind the same interface.
  const authenticators = new Map<string, Authenticator>([['codex', new CodexAuthenticator()]])
```

Change the `buildServer` call (line 45) to pass it:

```ts
  const app = await buildServer(config, db, registry, manager, {
    vapidPublicKey: vapid?.publicKey ?? null,
    authenticators,
  })
```

- [ ] **Step 2b:** Check for other `buildServer` callers (test harnesses) — the new opts field is optional so they keep compiling, but the auth routes won't mount without it; that's fine for tests that don't exercise auth:

```bash
grep -rn "buildServer(" apps/backend/src --include='*.ts' | grep -v 'export async function'
```
Expected: any hits are call sites that still typecheck (optional field).

- [ ] **Step 3:** Typecheck + full backend suite:

```bash
pnpm --filter @trux/backend typecheck && pnpm --filter @trux/backend exec vitest run
```
Expected: clean typecheck; all backend tests green (existing + the new auth tests).

- [ ] **Step 4:** Commit.

```bash
git add apps/backend/src/server.ts apps/backend/src/index.ts && git commit -m "feat(backend): mount the authenticator registry (codex) in the bearer scope

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Spine auth client

**Files:** Create `packages/client/src/auth.ts`, `packages/client/src/auth.test.ts`; modify `packages/client/package.json`.

Reuse the exact `authHeaders()` + `url()` plumbing from `api.ts:12-30` so the token + httpBase come from the injected ports.

- [ ] **Step 1:** Create `packages/client/src/auth.ts`:

```ts
import { getServerConfig, getStorage } from './ports'

export type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string | null }
  | { mode: 'apikey'; label: string }
export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'expired'
export interface ProviderInfo { id: string; plane: 'model' | 'machine' }

function authHeaders(): Record<string, string> {
  const token = getStorage().get('trux_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}
function url(path: string): string {
  return getServerConfig().httpBase + path
}
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export const authApi = {
  providers: () => fetch(url('/auth/providers'), { headers: authHeaders() }).then(json<ProviderInfo[]>),
  begin: (provider: string) =>
    fetch(url(`/auth/${provider}/begin`), { method: 'POST', headers: authHeaders() }).then(json<AuthMode>),
  poll: (provider: string) =>
    fetch(url(`/auth/${provider}/poll`), { headers: authHeaders() }).then(json<{ status: AuthStatus }>),
  status: (provider: string) =>
    fetch(url(`/auth/${provider}/status`), { headers: authHeaders() }).then(json<{ status: AuthStatus }>),
  disconnect: (provider: string) =>
    fetch(url(`/auth/${provider}/disconnect`), { method: 'POST', headers: authHeaders() }).then(json<{ status: AuthStatus }>),
  submitKey: (provider: string, key: string) =>
    fetch(url(`/auth/${provider}/key`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ key }),
    }).then(json<{ status: AuthStatus }>),
}
```

- [ ] **Step 2:** Create `packages/client/src/auth.test.ts` — mirror how `preview.test.ts` / other client tests configure the ports and stub `fetch`. The shape below configures the client and asserts the URL + bearer header:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureClient } from './ports'
import { authApi } from './auth'

beforeEach(() => {
  configureClient({
    storage: { get: (k) => (k === 'trux_token' ? 'secret123' : null), set: () => {}, remove: () => {} },
    serverConfig: { httpBase: 'https://box.ts.net', wsBase: 'wss://box.ts.net' },
  })
})

describe('authApi', () => {
  it('begin POSTs to the provider with the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mode: 'device', verifyUrl: 'https://x', userCode: 'A-1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await authApi.begin('codex')
    expect(fetchMock).toHaveBeenCalledWith('https://box.ts.net/auth/codex/begin', {
      method: 'POST',
      headers: { authorization: 'Bearer secret123' },
    })
    expect(res).toEqual({ mode: 'device', verifyUrl: 'https://x', userCode: 'A-1' })
  })
})
```

- [ ] **Step 3:** Add the subpath export to `packages/client/package.json` `"exports"` (after the `"./api"` line):

```json
    "./auth": "./src/auth.ts",
```

- [ ] **Step 4:** Run the client suite + typecheck:

```bash
pnpm --filter @trux/client exec vitest run src/auth.test.ts && pnpm --filter @trux/client typecheck
```
Expected: PASS, clean.

- [ ] **Step 5:** Commit.

```bash
git add packages/client/src/auth.ts packages/client/src/auth.test.ts packages/client/package.json && git commit -m "feat(client): authApi spine client + ./auth subpath export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Connections screen + entry point

**Files:** Create `apps/mobile/app/(app)/connections.tsx`; modify `apps/mobile/app/(app)/index.tsx`.

The screen mirrors `settings.tsx`'s header structure (own header + `router.back()`, since the Stack runs `headerShown: false`). Flow: list providers → tap **Connect** → call `authApi.begin` → show the verify URL + code (with a button to open the URL in the phone browser) → poll until `connected`; a **secondary** key field calls `authApi.submitKey`. Re-auth of a connected provider confirms first (findings caveat #1).

- [ ] **Step 1:** Read `apps/mobile/app/(app)/settings.tsx` in full to copy its exact `styles`, `SafeAreaView`/header idiom, theme import, and `haptic` usage — match them so the new screen is visually consistent. Also read one existing screen that does an async `api` call with loading state (e.g. `new.tsx`) for the project's loading/error convention.

- [ ] **Step 2:** Create `apps/mobile/app/(app)/connections.tsx`. Use `react-native`'s `Linking.openURL(verifyUrl)` for the "open in browser" button (works native + web), `expo-router`'s `useRouter` for back-nav, and `authApi` from `@trux/client/auth`. The component below is the full behavior — adapt the imports/style names to match what Step 1 found (theme path, `haptic`, shared `Button`/`Pressable` styling):

```tsx
import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, TextInput, Linking, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { authApi, type AuthStatus, type ProviderInfo } from '@trux/client/auth'

export default function ConnectionsScreen(): React.ReactElement {
  const router = useRouter()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [status, setStatus] = useState<Record<string, AuthStatus>>({})
  const [device, setDevice] = useState<{ verifyUrl: string; userCode: string | null } | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load providers + their current status on mount.
  useEffect(() => {
    authApi.providers().then(async (ps) => {
      setProviders(ps)
      const entries = await Promise.all(ps.map(async (p) => [p.id, (await authApi.status(p.id)).status] as const))
      setStatus(Object.fromEntries(entries))
    }).catch((e) => setError(String(e)))
  }, [])

  // While a device login is showing, poll until it leaves 'pending'.
  useEffect(() => {
    if (!active || !device) return
    const t = setInterval(async () => {
      const { status: s } = await authApi.poll(active)
      if (s !== 'pending') {
        setStatus((prev) => ({ ...prev, [active]: s }))
        if (s === 'connected') { setDevice(null); setActive(null) }
      }
    }, 2000)
    return () => clearInterval(t)
  }, [active, device])

  const connect = async (id: string): Promise<void> => {
    if (status[id] === 'connected' && !confirmReauth()) return
    setBusy(true); setError(null); setActive(id)
    try {
      const mode = await authApi.begin(id)
      if (mode.mode === 'device') setDevice({ verifyUrl: mode.verifyUrl, userCode: mode.userCode })
    } catch (e) { setError(String(e)); setActive(null) } finally { setBusy(false) }
  }

  const submitKey = async (id: string): Promise<void> => {
    setBusy(true); setError(null)
    try {
      const { status: s } = await authApi.submitKey(id, keyInput)
      setStatus((prev) => ({ ...prev, [id]: s })); setKeyInput('')
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  const disconnect = async (id: string): Promise<void> => {
    await authApi.disconnect(id)
    setStatus((prev) => ({ ...prev, [id]: 'disconnected' }))
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title}>Connections</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {providers.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.provider}>{p.id}</Text>
              <Text style={styles.status}>{status[p.id] ?? '…'}</Text>
            </View>
            <View style={styles.row}>
              <Pressable disabled={busy} onPress={() => connect(p.id)} style={styles.btn}>
                <Text style={styles.btnText}>{status[p.id] === 'connected' ? 'Reconnect' : 'Connect'}</Text>
              </Pressable>
              {status[p.id] === 'connected' ? (
                <Pressable onPress={() => disconnect(p.id)} style={styles.btnGhost}><Text style={styles.btnText}>Disconnect</Text></Pressable>
              ) : null}
            </View>
            {active === p.id && device ? (
              <View style={styles.device}>
                <Text style={styles.deviceLabel}>Open this URL on any device and sign in:</Text>
                <Pressable onPress={() => Linking.openURL(device.verifyUrl)}><Text style={styles.link}>{device.verifyUrl}</Text></Pressable>
                {device.userCode ? <Text style={styles.code}>code: {device.userCode}</Text> : null}
              </View>
            ) : null}
            <View style={styles.keyRow}>
              <TextInput
                style={styles.input}
                value={active === p.id ? keyInput : ''}
                onFocus={() => setActive(p.id)}
                onChangeText={setKeyInput}
                placeholder="…or paste an API key"
                autoCapitalize="none"
                secureTextEntry
              />
              <Pressable disabled={busy || !keyInput} onPress={() => submitKey(p.id)} style={styles.btn}><Text style={styles.btnText}>Save</Text></Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

// Native confirm is async; for the lean cut, allow re-auth (the CLI clears the
// old session anyway). Replace with a real Alert.alert confirm if desired.
function confirmReauth(): boolean { return true }

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#0b0b0c' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: '#fff', fontSize: 28 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  body: { padding: 16, gap: 16 },
  error: { color: '#f87171' },
  card: { backgroundColor: '#161618', borderRadius: 12, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  provider: { color: '#fff', fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  status: { color: '#9ca3af' },
  btn: { backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  btnGhost: { backgroundColor: '#27272a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  btnText: { color: '#fff', fontWeight: '600' },
  device: { backgroundColor: '#0b0b0c', borderRadius: 8, padding: 12, gap: 6 },
  deviceLabel: { color: '#9ca3af', fontSize: 13 },
  link: { color: '#60a5fa', textDecorationLine: 'underline' },
  code: { color: '#fff', fontSize: 18, fontWeight: '700', letterSpacing: 2 },
  keyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#0b0b0c', color: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
})
```

**Note:** the inline `styles` above are a self-contained fallback so the screen renders even if read of `settings.tsx` is skipped. If `settings.tsx` exposes a shared theme/token module (Step 1), prefer those values for exact visual consistency.

- [ ] **Step 3:** In `apps/mobile/app/(app)/index.tsx`, add a header button to reach the screen. Mirror the existing `settingsBtn` pattern (around lines 81-86) — add a sibling `Pressable` before or after it:

```tsx
        <Pressable hitSlop={12} onPress={() => router.push('/connections')} style={styles.settingsBtn}>
          <Text style={styles.settingsBtnText}>🔑</Text>
        </Pressable>
```
(If a `styles.settingsBtn` reuse looks cramped next to the ⚙ and + buttons, add a `connBtn` style cloned from `settingsBtn`.)

- [ ] **Step 4:** Typecheck mobile + run its suite:

```bash
pnpm --filter @trux/mobile typecheck && pnpm --filter @trux/mobile test
```
Expected: clean typecheck; suite green (the contention-flaky new/ToolView/GitPanel trio may need a rerun — confirm 85/85+ on rerun, not a regression).

- [ ] **Step 5:** Commit.

```bash
git add apps/mobile/app/'(app)'/connections.tsx apps/mobile/app/'(app)'/index.tsx && git commit -m "feat(mobile): Connections screen (codex device login + key fallback) + header entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Render gate + end-to-end verification

Build ≠ runtime. Prove the relay works against the real backend with a **faked codex** (we won't burn the user's real ChatGPT session, and the box's codex is currently logged out from the spike).

- [ ] **Step 1:** Add a dev-only spawn override so the render gate doesn't shell the real `codex`. The cleanest seam already exists — `CodexAuthenticator` takes a `SpawnFn`. Confirm an env hook in `index.ts` that, when `TRUX_FAKE_CODEX=1`, constructs `new CodexAuthenticator(fakeSpawn)` where `fakeSpawn` emits a canned device URL on first call and exits 0 on a second `status`/poll. (If you prefer not to add prod code for this, instead start a tiny standalone Fastify in the test harness that mounts `registerAuth` with a fake authenticator — same as `auth-route.test.ts` — and point the web app's `httpBase` at it.) Keep whichever is lower-footprint; do not leave fake-codex wiring enabled by default.

- [ ] **Step 2:** Build the web surface and start the backend with auth on and the fake:

```bash
pnpm --filter @trux/mobile build:web
TRUX_AUTH=1 TRUX_SECRET=rendertest TRUX_FAKE_CODEX=1 TRUX_PORT=14317 pnpm --filter @trux/backend start
```

- [ ] **Step 3:** With the `playwright` skill, open `http://localhost:14317/#token=rendertest`, navigate to Connections (the 🔑 header button), and verify:
  - the provider list renders with `codex` and a status,
  - tapping **Connect** shows the verify URL + code (the relay round-trip: begin → device mode → rendered),
  - no uncaught console errors.
  Capture a mobile-viewport (390px) screenshot per the project's mobile-UX standard.

- [ ] **Step 4:** Tear down the backend (precise kill, not `pkill -f`):

```bash
lsof -ti tcp:14317 | xargs -r kill
```

- [ ] **Step 5:** Commit any fixes from the gate.

```bash
git add -A && git commit -m "test(authenticator): render gate fixes (Connections relay round-trip)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Finish

- [ ] **Step 1:** Full green:

```bash
pnpm --filter @trux/backend exec vitest run \
  && pnpm --filter @trux/client exec vitest run \
  && pnpm --filter @trux/mobile test \
  && pnpm -r typecheck \
  && echo ALL GREEN
```
Expected: backend (existing + auth), client (existing + auth), mobile suites pass; typecheck clean.

- [ ] **Step 2:** Native acceptance is the **user's** step (device-only, like Fly/EAS): `pnpm --filter @trux/mobile exec expo run:android`, open Connections, tap **Connect** on codex, complete the real `codex login --device-auth` on the phone browser, confirm status flips to `connected` and a subsequent agent turn uses the subscription. Note this in the handoff; do not block the merge on it.

- [ ] **Step 3:** Merge per workflow. Use superpowers:finishing-a-development-branch to merge `feat/authenticator-phase1` → `main` (merge when green); remove the worktree.

- [ ] **Step 4:** Update memory `trux-authenticator-oauth-first.md`: record Phase 1 shipped (registry + Codex device-login + key fallback + Connections screen), the merge commit, the deferred Phase 2 items, and that real-device acceptance is the user's step.

---

## Self-Review

**Spec coverage** (against `2026-06-22-provider-authenticator-design.md` Phase 1 + the Phase 0 findings):
- `Authenticator` registry mirroring the agent registry → Task 1 (interface) + Task 4 (map in `index.ts`, `.get()` lookup in the route). ✓
- Connections phone screen → Task 6. ✓
- One agent's subscription login end-to-end → Task 2 (Codex device flow) + Task 3 (REST) + Task 5 (spine) + Task 6 (UI) + Task 7 (render gate). ✓
- API-key fallback on the same adapter → `submitKey` (Tasks 2/3/5/6). ✓
- Model-plane credential delivery (creds land on the box) → the CLI writes `~/.codex/auth.json`; trux stores nothing itself (principle #3/#4). ✓
- Status surfaces connected/expired so a turn never fails opaquely → `status()`/`poll()` + the screen's status line (Tasks 2/6). ✓
- Findings caveats (destructive login, env-key shadow, CLI owns polling) → carried into the dedicated caveats section + Task 6 re-auth confirm. ✓
- **Cleanest target = Codex** per findings → the only Phase 1 adapter; Claude/opencode/machine = Phase 2 (explicitly out of scope). ✓

**Placeholder scan:** the two "read the file then match its style" steps (Task 6 Step 1 reading `settings.tsx`; the `buildServer` caller grep in Task 4 Step 2b) are deliberate adaptation points, not invented APIs — and Task 6 ships a fully self-contained component with fallback styles so it renders regardless. Everything else is exact code.

**Type consistency:** `AuthMode`/`AuthStatus`/`Authenticator` are defined once in `auth-provider.ts` (Task 1) and re-declared structurally in `packages/client/src/auth.ts` (Task 5) because the spine can't import backend types — the shapes match field-for-field (`mode`/`verifyUrl`/`userCode`; `'disconnected'|'pending'|'connected'|'expired'`). The route paths (`/auth/:provider/{begin,poll,status,disconnect,key}`) are identical across the backend routes (Task 3), the spine client (Task 5), and the screen's calls (Task 6). `submitKey` is named consistently everywhere; the REST surface for it is `/key`.
