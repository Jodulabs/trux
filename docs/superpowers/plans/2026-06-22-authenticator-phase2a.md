# Authenticator Phase 2a — Claude + opencode Model Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Per the user's standing preference this plan is **lean** — implement directly, unit-test the pure parsers and the adapters via their injected seams, add a render gate, but skip the write-failing-test-first ceremony.

**Goal:** Add the two remaining **model-plane** authenticators — **Claude** (`claude setup-token`, paste-code-back) and **opencode** (write the `opencode-go` key into opencode's own `auth.json`) — behind the existing `Authenticator` interface, surfaced in the same Connections screen, with **expiry surfacing** for both.

**Architecture:** Phase 1 shipped the registry, REST surface, spine client, and Connections screen with **Codex**. This extends them: a small interface addition (`submitCode` + a `needsCode` flag on device mode) to support Claude's paste-the-returned-code flow, a `ClaudeAuthenticator` that scrapes `claude setup-token`'s URL and feeds the pasted code to its stdin, and an `OpencodeAuthenticator` that is purely file-based (writes/reads/clears the `opencode-go` entry in `~/.local/share/opencode/auth.json` via an injected fs seam). Both register in `index.ts` alongside codex. trux reimplements no OAuth — Claude's CLI owns the token + refresh; opencode-go is its own API key.

**Tech Stack:** Node `child_process.spawn` (Claude CLI), Node `fs` (opencode auth.json, injected for tests), Fastify (one new `/code` route), the `@trux/client` ports, expo-router (Connections screen extension), Vitest.

**Scope (Phase 2a only):** Claude + opencode model adapters + expiry surfacing. **Out (Phase 2b):** machine providers (Fly/GCP — different credential plane, GCP OAuth still undesigned), deep refresh automation + Fly `/data` persistence. The Phase 0 findings note governs the mechanics; its three caveats are carried below.

**Branch / workspace:** a git **worktree** on `feat/authenticator-phase2a`.

---

## Findings-note facts carried into this plan

- **Claude cred store** (from the spike, verbatim): `~/.claude/.credentials.json` → `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier } }`. `claude auth status` prints JSON: `{ loggedIn, authMethod, apiProvider, apiKeySource, … }`. `claude setup-token` is paste-code-back (it hung waiting for interactive input under `</dev/null`).
- **`claude setup-token` mechanic is the one unverified piece** — exactly like codex's `--device-auth` was in Phase 1. It is fake-spawn-tested here and confirmed at device-acceptance (Task 6 Step 6). If the real CLI prints a token instead of taking a pasted code, the adapter's `submitCode` body is a one-line change; the interface does not move.
- **opencode-go is API-key based** (`opencode auth list` shows `OpenCode Go [api]`); the spike read `~/.local/share/opencode/auth.json` as `{ "opencode-go": { "type": "api", "key": "…" }, "openai": {…oauth}, … }`. So opencode's ToS-safe subscription path is key-paste into that file — opencode authenticating to its own provider.
- **Caveat (env key shadows OAuth):** a present `ANTHROPIC_API_KEY` shadows the Claude OAuth store (`apiKeySource: ANTHROPIC_API_KEY` even when `authMethod: claude.ai`). `claudeStatus` must report from the CLI's own JSON, and the UI status reflects what the CLI reports.
- **Caveat (Agent SDK cred read) — VERIFY, don't block:** trux's claude *adapter* uses `@anthropic-ai/claude-agent-sdk`, not the `claude` binary. The CLI writes `~/.claude/.credentials.json`; whether the SDK reads that same OAuth store (vs only env) is confirmed at device-acceptance (Task 6 Step 6), not in CI.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/backend/src/auth-provider.ts` | modify | add `submitCode?` to `Authenticator`, `needsCode?` to device `AuthMode`; add `parseClaudeStatus` + `parseClaudeSetupOutput` |
| `apps/backend/src/auth-claude.ts` | create | `ClaudeAuthenticator` — spawn `claude setup-token`, scrape URL, feed pasted code to stdin; `status` via `claude auth status` JSON |
| `apps/backend/test/auth-claude.test.ts` | create | parsers + begin→submitCode→connected + status + expiry, via a fake spawn |
| `apps/backend/src/auth-opencode.ts` | create | `OpencodeAuthenticator` — file-based: write/read/clear `opencode-go` in opencode's `auth.json` (injected fs seam) |
| `apps/backend/test/auth-opencode.test.ts` | create | submitKey writes the entry, status reads it, disconnect clears it — via an in-memory fs |
| `apps/backend/src/auth-route.ts` | modify | add `POST /auth/:provider/code` |
| `apps/backend/test/auth-route.test.ts` | modify | add a `/code` happy-path + 400-when-unsupported case |
| `apps/backend/src/index.ts` | modify | register `ClaudeAuthenticator` + `OpencodeAuthenticator` in the map |
| `packages/client/src/auth.ts` | modify | add `submitCode`; add `needsCode?` to the device `AuthMode` |
| `packages/client/test/auth.test.ts` | modify | add a `submitCode` shape test |
| `apps/mobile/app/(app)/connections.tsx` | modify | when `needsCode`, show a "paste the code shown after sign-in" field → `submitCode`; for `apikey`-mode begin, show a hint |

---

## Task 1: Interface extension + Claude parsers

**Files:** Modify `apps/backend/src/auth-provider.ts`; create `apps/backend/test/auth-claude.test.ts` (parser portion).

- [ ] **Step 1:** Edit `apps/backend/src/auth-provider.ts`. Add `needsCode` to the device variant and `submitCode` to the interface, and append the two Claude parsers. Replace the type+interface block (lines 3–16) with:

```ts
export type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string | null; needsCode?: boolean } // needsCode: after signing in, paste the returned code back (Claude setup-token)
  | { mode: 'apikey'; label: string } // secondary: paste a key, box stores via the CLI/file
export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'expired'

export interface Authenticator {
  readonly id: string // 'codex' | 'claude' | 'opencode' | 'fly' | …
  readonly plane: 'model' | 'machine' // decides where the credential lands
  begin(): Promise<AuthMode>
  poll(): Promise<AuthStatus> // device flow: box watches the CLI's progress
  status(): Promise<AuthStatus>
  disconnect(): Promise<void>
  submitKey?(key: string): Promise<AuthStatus> // the key fallback
  submitCode?(code: string): Promise<AuthStatus> // paste-code-back (Claude): the code shown after browser sign-in
}
```

- [ ] **Step 2:** Append the Claude parsers to the same file:

```ts
// `claude setup-token` prints a sign-in URL, then waits for the user to paste the
// code shown after they authorize in the browser. Scrape the first https URL.
export function parseClaudeSetupOutput(buf: string): { verifyUrl: string } | null {
  const m = /(https?:\/\/[^\s]+)/.exec(buf)
  if (!m) return null
  return { verifyUrl: m[1].replace(/[).,]+$/, '') }
}

// `claude auth status` prints JSON, e.g. {"loggedIn":true,"authMethod":"claude.ai",…}.
// Map loggedIn→connected. (Token refresh is the SDK/CLI's job; expiry is surfaced
// by the credentials-file check in auth-claude.ts, not here.)
export function parseClaudeStatus(out: string): AuthStatus {
  try {
    const d = JSON.parse(out) as { loggedIn?: boolean }
    return d.loggedIn ? 'connected' : 'disconnected'
  } catch {
    // Fallback for non-JSON output.
    return /logged in|loggedIn.*true/i.test(out) && !/not logged in/i.test(out) ? 'connected' : 'disconnected'
  }
}
```

- [ ] **Step 3:** Create `apps/backend/test/auth-claude.test.ts` with the parser tests (adapter tests come in Task 2):

```ts
import { describe, it, expect } from 'vitest'
import { parseClaudeSetupOutput, parseClaudeStatus } from '../src/auth-provider'

describe('parseClaudeSetupOutput', () => {
  it('extracts the sign-in URL', () => {
    expect(parseClaudeSetupOutput('Visit https://claude.ai/oauth/authorize?x=1 to continue')).toEqual({
      verifyUrl: 'https://claude.ai/oauth/authorize?x=1',
    })
  })
  it('returns null before a URL appears', () => {
    expect(parseClaudeSetupOutput('Starting…')).toBeNull()
  })
})

describe('parseClaudeStatus', () => {
  it('maps loggedIn JSON to connected', () => {
    expect(parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai"}')).toBe('connected')
  })
  it('maps logged-out JSON to disconnected', () => {
    expect(parseClaudeStatus('{"loggedIn":false}')).toBe('disconnected')
  })
})
```

- [ ] **Step 4:** Run + typecheck:

```bash
pnpm --filter @trux/backend exec vitest run test/auth-claude.test.ts && pnpm --filter @trux/backend typecheck
```
Expected: PASS (4 assertions); typecheck clean (the optional `submitCode`/`needsCode` don't break the existing codex adapter).

- [ ] **Step 5:** Commit.

```bash
git add apps/backend/src/auth-provider.ts apps/backend/test/auth-claude.test.ts && git commit -m "feat(backend): extend Authenticator with submitCode/needsCode + claude parsers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: ClaudeAuthenticator (setup-token, paste-code-back)

**Files:** Create `apps/backend/src/auth-claude.ts`; extend `apps/backend/test/auth-claude.test.ts`.

Reuse the `SpawnFn`/`AuthChild` seam exported from `auth-codex.ts` so the fake-child test helper is identical. `begin()` spawns `claude setup-token`, scrapes the URL, holds the child, and returns device mode with `needsCode: true`; `submitCode()` writes the pasted code to the held child's stdin and resolves on exit 0. `status()` shells `claude auth status`. Expiry: read `~/.claude/.credentials.json` and compare `expiresAt`.

- [ ] **Step 1:** Create `apps/backend/src/auth-claude.ts`:

```ts
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'
import { parseClaudeSetupOutput, parseClaudeStatus } from './auth-provider'
import { type AuthChild, type SpawnFn } from './auth-codex'

const defaultSpawn: SpawnFn = (cmd, args) => spawn(cmd, args) as unknown as AuthChild

// Read the OAuth credential file to surface expiry. Injected for tests.
export type ReadCredsFn = () => { expiresAt?: number } | null
const defaultReadCreds: ReadCredsFn = () => {
  try {
    const raw = readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8')
    return (JSON.parse(raw) as { claudeAiOauth?: { expiresAt?: number } }).claudeAiOauth ?? null
  } catch {
    return null
  }
}

export class ClaudeAuthenticator implements Authenticator {
  readonly id = 'claude'
  readonly plane = 'model' as const

  // The in-flight setup-token child (awaiting a pasted code) + its reached status.
  private child: AuthChild | null = null
  private flowStatus: AuthStatus = 'disconnected'

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly readCreds: ReadCredsFn = defaultReadCreds,
  ) {}

  begin(): Promise<AuthMode> {
    this.child?.kill()
    const child = this.spawnFn('claude', ['setup-token'])
    this.child = child
    this.flowStatus = 'pending'
    let buf = ''
    return new Promise<AuthMode>((resolve, reject) => {
      let settled = false
      const onData = (d: Buffer): void => {
        buf += d.toString()
        const parsed = parseClaudeSetupOutput(buf)
        if (parsed && !settled) {
          settled = true
          resolve({ mode: 'device', verifyUrl: parsed.verifyUrl, userCode: null, needsCode: true })
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('exit', (code: number) => {
        this.flowStatus = code === 0 ? 'connected' : 'disconnected'
        this.child = null
        if (!settled) {
          settled = true
          reject(new Error('claude setup-token exited before printing a sign-in URL'))
        }
      })
    })
  }

  // After the user signs in and gets a code, they paste it; feed it to the held
  // child's stdin. Resolve once the child stores creds and exits.
  submitCode(code: string): Promise<AuthStatus> {
    const child = this.child
    if (!child) return Promise.resolve('disconnected')
    return new Promise<AuthStatus>((resolve) => {
      child.on('exit', (c: number) => {
        this.flowStatus = c === 0 ? 'connected' : 'disconnected'
        this.child = null
        resolve(this.flowStatus)
      })
      child.stdin.write(code.trim() + '\n')
      child.stdin.end()
    })
  }

  async poll(): Promise<AuthStatus> {
    if (this.child) return 'pending'
    return this.flowStatus === 'connected' ? 'connected' : this.status()
  }

  async status(): Promise<AuthStatus> {
    const base = await this.run(['auth', 'status']).then((o) => parseClaudeStatus(o)).catch(() => 'disconnected')
    if (base !== 'connected') return base
    // Connected per the CLI — surface expiry from the credential file if past.
    const creds = this.readCreds()
    if (creds?.expiresAt && creds.expiresAt < Date.now()) return 'expired'
    return 'connected'
  }

  async disconnect(): Promise<void> {
    this.child?.kill()
    this.child = null
    this.flowStatus = 'disconnected'
    await this.run(['auth', 'logout']).catch(() => undefined)
  }

  private run(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnFn('claude', args)
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('exit', (code: number) => (code === 0 ? resolve(out) : reject(new Error(`claude ${args.join(' ')} exited ${code}`))))
    })
  }
}
```

- [ ] **Step 2:** Extend `apps/backend/test/auth-claude.test.ts` — append a fake-child helper (identical shape to the codex test's, with `configurable: true`) and lifecycle tests:

```ts
import { EventEmitter } from 'node:events'
import { ClaudeAuthenticator } from '../src/auth-claude'
import type { AuthChild, SpawnFn } from '../src/auth-codex'

function fakeChild(): AuthChild & { emitOut(s: string): void; emitExit(code: number): void; written: string } {
  const ee = new EventEmitter() as AuthChild & { emitOut(s: string): void; emitExit(code: number): void; written: string }
  ee.written = ''
  Object.defineProperty(ee, 'stdout', { value: new EventEmitter(), configurable: true })
  Object.defineProperty(ee, 'stderr', { value: new EventEmitter(), configurable: true })
  Object.defineProperty(ee, 'stdin', { value: { write: (s: string) => (ee.written += s), end: () => {} }, configurable: true })
  ee.kill = () => true
  ee.emitOut = (s) => (ee.stdout as EventEmitter).emit('data', Buffer.from(s))
  ee.emitExit = (code) => ee.emit('exit', code)
  return ee
}

describe('ClaudeAuthenticator', () => {
  it('begin() resolves device mode with needsCode once the URL prints', async () => {
    const child = fakeChild()
    const auth = new ClaudeAuthenticator(() => child, () => null)
    const p = auth.begin()
    child.emitOut('Open https://claude.ai/oauth/authorize?x=1 and paste the code below')
    await expect(p).resolves.toEqual({ mode: 'device', verifyUrl: 'https://claude.ai/oauth/authorize?x=1', userCode: null, needsCode: true })
  })

  it('submitCode() writes the code to stdin and maps exit 0 to connected', async () => {
    const child = fakeChild()
    const auth = new ClaudeAuthenticator(() => child, () => null)
    const p = auth.begin()
    child.emitOut('Open https://claude.ai/x and paste the code')
    await p
    const sp = auth.submitCode('ABC-123')
    child.emitExit(0)
    expect(await sp).toBe('connected')
    expect(child.written).toContain('ABC-123')
  })

  it('status() surfaces expired when the credential file is past expiry', async () => {
    // status spawns `claude auth status`; return loggedIn JSON, then check creds.
    const statusChild = fakeChild()
    const spawnFn: SpawnFn = () => statusChild
    const auth = new ClaudeAuthenticator(spawnFn, () => ({ expiresAt: Date.now() - 1000 }))
    const p = auth.status()
    statusChild.emitOut('{"loggedIn":true,"authMethod":"claude.ai"}')
    statusChild.emitExit(0)
    expect(await p).toBe('expired')
  })
})
```

- [ ] **Step 3:** Run + typecheck:

```bash
pnpm --filter @trux/backend exec vitest run test/auth-claude.test.ts && pnpm --filter @trux/backend typecheck
```
Expected: PASS (7 assertions total); clean.

- [ ] **Step 4:** Commit.

```bash
git add apps/backend/src/auth-claude.ts apps/backend/test/auth-claude.test.ts && git commit -m "feat(backend): ClaudeAuthenticator — setup-token paste-code-back + expiry surfacing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: OpencodeAuthenticator (file-based opencode-go key)

**Files:** Create `apps/backend/src/auth-opencode.ts`, `apps/backend/test/auth-opencode.test.ts`.

opencode-go is API-key based, so this adapter is purely file-based — no spawn, no TUI scrape. `begin()` returns apikey mode; `submitKey()` merges `{ type: 'api', key }` under `opencode-go` in opencode's `auth.json`; `status()` reads the file and reports connected when that entry has a key; `disconnect()` removes it. The fs read/write are injected for tests.

- [ ] **Step 1:** Create `apps/backend/src/auth-opencode.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'

// opencode-go is opencode's own (API-key) provider — the ToS-safe subscription
// path for opencode is a key in opencode's own auth store. Default path from the
// spike: ~/.local/share/opencode/auth.json.
const OPENCODE_GO = 'opencode-go'
type AuthFile = Record<string, { type: string; key?: string } | undefined>

export interface FsSeam {
  read(): AuthFile
  write(data: AuthFile): void
}
const defaultPath = (): string => join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const defaultFs: FsSeam = {
  read: () => {
    try {
      return JSON.parse(readFileSync(defaultPath(), 'utf8')) as AuthFile
    } catch {
      return {}
    }
  },
  write: (data) => {
    const p = defaultPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 })
  },
}

export class OpencodeAuthenticator implements Authenticator {
  readonly id = 'opencode'
  readonly plane = 'model' as const

  constructor(private readonly fs: FsSeam = defaultFs) {}

  // opencode-go is key-based; the screen shows the key field. No device flow.
  begin(): Promise<AuthMode> {
    return Promise.resolve({ mode: 'apikey', label: 'opencode-go API key' })
  }

  submitKey(key: string): Promise<AuthStatus> {
    const data = this.fs.read()
    data[OPENCODE_GO] = { type: 'api', key: key.trim() }
    this.fs.write(data)
    return Promise.resolve('connected')
  }

  status(): Promise<AuthStatus> {
    const entry = this.fs.read()[OPENCODE_GO]
    return Promise.resolve(entry && entry.key ? 'connected' : 'disconnected')
  }

  // poll mirrors status — opencode has no in-flight device login.
  poll(): Promise<AuthStatus> {
    return this.status()
  }

  disconnect(): Promise<void> {
    const data = this.fs.read()
    delete data[OPENCODE_GO]
    this.fs.write(data)
    return Promise.resolve()
  }
}
```

- [ ] **Step 2:** Create `apps/backend/test/auth-opencode.test.ts` with an in-memory fs:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { OpencodeAuthenticator, type FsSeam } from '../src/auth-opencode'

function memFs(initial: Record<string, unknown> = {}): FsSeam & { data: Record<string, unknown> } {
  const store: { data: Record<string, unknown> } = { data: { ...initial } }
  return {
    data: store.data,
    read: () => store.data as never,
    write: (d) => { store.data = d as never; (store as { data: Record<string, unknown> }).data = d as never },
  } as FsSeam & { data: Record<string, unknown> }
}

describe('OpencodeAuthenticator', () => {
  it('begin() returns apikey mode', async () => {
    const auth = new OpencodeAuthenticator(memFs())
    expect(await auth.begin()).toEqual({ mode: 'apikey', label: 'opencode-go API key' })
  })
  it('submitKey writes the opencode-go entry and status reports connected', async () => {
    const fs = memFs()
    const auth = new OpencodeAuthenticator(fs)
    expect(await auth.status()).toBe('disconnected')
    expect(await auth.submitKey('sk-oc-123')).toBe('connected')
    expect((fs.read() as Record<string, { type: string; key: string }>)['opencode-go']).toEqual({ type: 'api', key: 'sk-oc-123' })
    expect(await auth.status()).toBe('connected')
  })
  it('disconnect removes the entry but preserves other providers', async () => {
    const fs = memFs({ openai: { type: 'oauth' }, 'opencode-go': { type: 'api', key: 'x' } })
    const auth = new OpencodeAuthenticator(fs)
    await auth.disconnect()
    expect((fs.read() as Record<string, unknown>)['opencode-go']).toBeUndefined()
    expect((fs.read() as Record<string, unknown>)['openai']).toEqual({ type: 'oauth' })
  })
})
```

- [ ] **Step 3:** Run + typecheck:

```bash
pnpm --filter @trux/backend exec vitest run test/auth-opencode.test.ts && pnpm --filter @trux/backend typecheck
```
Expected: PASS; clean.

- [ ] **Step 4:** Commit.

```bash
git add apps/backend/src/auth-opencode.ts apps/backend/test/auth-opencode.test.ts && git commit -m "feat(backend): OpencodeAuthenticator — file-based opencode-go key (own provider)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: REST `/code` route + register both adapters

**Files:** Modify `apps/backend/src/auth-route.ts`, `apps/backend/test/auth-route.test.ts`, `apps/backend/src/index.ts`.

- [ ] **Step 1:** In `apps/backend/src/auth-route.ts`, add a `/code` route after the `/key` route (before the closing `}` of `registerAuth`):

```ts
  app.post('/auth/:provider/code', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    if (!a.submitCode) return reply.code(400).send({ error: 'provider has no code step' })
    const body = req.body as { code?: string }
    if (!body || typeof body.code !== 'string' || body.code.length === 0) {
      return reply.code(400).send({ error: 'code is required' })
    }
    return { status: await a.submitCode(body.code) }
  })
```

- [ ] **Step 2:** In `apps/backend/test/auth-route.test.ts`, extend the `FakeAuth` class with a `submitCode` and add a test. Add to the class body (after `submitKey`):

```ts
  submitCode(code: string): Promise<AuthStatus> { return Promise.resolve(code === 'good' ? 'connected' : 'disconnected') }
```

And add a test inside the `describe`:

```ts
  it('code step validates and maps the result', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/codex/code', payload: { code: 'good' } })).json()).toEqual({ status: 'connected' })
    expect((await app.inject({ method: 'POST', url: '/auth/codex/code', payload: {} })).statusCode).toBe(400)
  })
```

- [ ] **Step 3:** In `apps/backend/src/index.ts`, import the two adapters and add them to the authenticators map. Add imports after the `CodexAuthenticator` import:

```ts
import { ClaudeAuthenticator } from './auth-claude'
import { OpencodeAuthenticator } from './auth-opencode'
```

Replace the single-entry map with all three (order = display order on the screen):

```ts
  const authenticators = new Map<string, Authenticator>([
    ['claude', new ClaudeAuthenticator()],
    ['codex', new CodexAuthenticator()],
    ['opencode', new OpencodeAuthenticator()],
  ])
```

- [ ] **Step 4:** Run the full backend suite + typecheck:

```bash
pnpm --filter @trux/backend exec vitest run && pnpm --filter @trux/backend typecheck
```
Expected: all green (existing + the 3 new auth files + the new route case); clean.

- [ ] **Step 5:** Commit.

```bash
git add apps/backend/src/auth-route.ts apps/backend/test/auth-route.test.ts apps/backend/src/index.ts && git commit -m "feat(backend): /auth/:provider/code route + register claude & opencode adapters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Spine `submitCode` + Connections screen (code field + apikey hint)

**Files:** Modify `packages/client/src/auth.ts`, `packages/client/test/auth.test.ts`, `apps/mobile/app/(app)/connections.tsx`.

- [ ] **Step 1:** In `packages/client/src/auth.ts`, add `needsCode` to the device `AuthMode` and a `submitCode` method. Change the `AuthMode` device line:

```ts
export type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string | null; needsCode?: boolean }
  | { mode: 'apikey'; label: string }
```

Add to the `authApi` object (after `submitKey`):

```ts
  submitCode: (provider: string, code: string) =>
    fetch(url(`/auth/${provider}/code`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ code }),
    }).then(json<{ status: AuthStatus }>),
```

- [ ] **Step 2:** In `packages/client/test/auth.test.ts`, add a `submitCode` shape test (mirror the existing `begin` test's fetch-stub style):

```ts
  it('submitCode POSTs the code with the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'connected' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await authApi.submitCode('claude', 'ABC-123')
    expect(fetchMock).toHaveBeenCalledWith('https://box.ts.net/auth/claude/code', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret123' },
      body: JSON.stringify({ code: 'ABC-123' }),
    })
    expect(res).toEqual({ status: 'connected' })
  })
```

- [ ] **Step 3:** Run the client suite + typecheck:

```bash
pnpm --filter @trux/client exec vitest run test/auth.test.ts && pnpm --filter @trux/client typecheck
```
Expected: PASS; clean.

- [ ] **Step 4:** Edit `apps/mobile/app/(app)/connections.tsx`. Three changes:

(a) Track `needsCode` + a code input. Change the `device` state and add `codeInput`:

```tsx
  const [device, setDevice] = useState<{ verifyUrl: string; userCode: string | null; needsCode?: boolean } | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [hint, setHint] = useState<string | null>(null)
```

(b) In `connect`, handle both device (carry `needsCode`) and apikey (show a hint) modes. Replace the `try` block body in `connect`:

```tsx
    try {
      const mode = await authApi.begin(id)
      if (mode.mode === 'device') { setDevice({ verifyUrl: mode.verifyUrl, userCode: mode.userCode, needsCode: mode.needsCode }); setHint(null) }
      else { setHint(mode.label); setDevice(null) } // apikey mode: prompt the key field
    } catch (e) { setError(String(e)); setActive(null) } finally { setBusy(false) }
```

(c) Add a `submitCode` handler (after `submitKey`):

```tsx
  const submitCode = async (id: string): Promise<void> => {
    haptic('medium')
    setBusy(true); setError(null)
    try {
      const { status: s } = await authApi.submitCode(id, codeInput)
      setStatus((prev) => ({ ...prev, [id]: s })); setCodeInput('')
      if (s === 'connected') { haptic('success'); setDevice(null); setActive(null) }
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
```

(d) In the device block JSX, when `device.needsCode`, render a code field + Submit. Replace the device block (the `{active === p.id && device ? (…) : null}`) with:

```tsx
            {active === p.id && device ? (
              <View style={styles.device}>
                <Text style={styles.deviceLabel}>Open this URL and sign in:</Text>
                <Pressable onPress={() => Linking.openURL(device.verifyUrl)}>
                  <Text style={styles.link}>{device.verifyUrl}</Text>
                </Pressable>
                {device.userCode ? <Text style={styles.code}>code: {device.userCode}</Text> : null}
                {device.needsCode ? (
                  <View style={styles.keyRow}>
                    <TextInput
                      style={styles.input}
                      value={codeInput}
                      onChangeText={setCodeInput}
                      placeholder="paste the code shown after sign-in"
                      placeholderTextColor={theme.textFaint}
                      autoCapitalize="none"
                    />
                    <Pressable disabled={busy || !codeInput} onPress={() => submitCode(p.id)} style={styles.btn}>
                      <Text style={styles.btnText}>Submit</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
            {active === p.id && hint ? <Text style={styles.deviceLabel}>{hint} — paste it below.</Text> : null}
```

- [ ] **Step 5:** Typecheck mobile + run its suite:

```bash
pnpm --filter @trux/mobile typecheck && pnpm --filter @trux/mobile test
```
Expected: clean; suite green (the contention-flaky new/ToolView/GitPanel trio may need a rerun — confirm not a regression).

- [ ] **Step 6:** Commit.

```bash
git add packages/client/src/auth.ts packages/client/test/auth.test.ts apps/mobile/app/'(app)'/connections.tsx && git commit -m "feat(client,mobile): submitCode + Connections code field (claude paste-back) & apikey hint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Render gate + finish

Prove it renders + the relays round-trip with **faked** CLIs (never shell the real claude/opencode — they'd mutate the user's live logins, the Phase 0 lesson).

- [ ] **Step 1:** Write a throwaway harness `apps/backend/src/_rendergate.ts` (untracked; delete after) that boots the real `buildServer` with three **fake** authenticators — codex (device), claude (device + needsCode, where `submitCode('any')`→connected), opencode (apikey, `submitKey`→connected). Model it on the Phase 1 render-gate harness pattern: in-memory db, real adapters map for agents, fake authenticators map, `config` with `authRequired: true, secret: 'rendertest', port: 14317`. Each fake `Authenticator` is a plain object literal implementing the interface (no CLI).

- [ ] **Step 2:** Build web + start the harness:

```bash
pnpm --filter @trux/mobile build:web
lsof -ti tcp:14317 | xargs -r kill 2>/dev/null; pnpm --filter @trux/backend exec tsx src/_rendergate.ts > /tmp/rg2.log 2>&1 &
sleep 4 && cat /tmp/rg2.log
```

- [ ] **Step 3:** curl the new surfaces:

```bash
curl -s -H "Authorization: Bearer rendertest" http://127.0.0.1:14317/auth/providers   # expect claude, codex, opencode
curl -s -X POST -H "Authorization: Bearer rendertest" http://127.0.0.1:14317/auth/claude/begin  # expect needsCode:true
curl -s -X POST -H "Authorization: Bearer rendertest" -H 'content-type: application/json' -d '{"code":"X-1"}' http://127.0.0.1:14317/auth/claude/code  # expect {"status":"connected"}
curl -s -X POST -H "Authorization: Bearer rendertest" http://127.0.0.1:14317/auth/opencode/begin  # expect mode:apikey
```
Expected: three providers; claude begin shows `needsCode: true`; claude code → connected; opencode begin → apikey.

- [ ] **Step 4:** With the `playwright` skill, open `http://localhost:14317/#token=rendertest`, navigate to `/connections` at 390px, and verify: all three providers render; tapping **Connect** on claude shows the URL + the paste-code field; submitting a code flips status to connected; opencode's card shows the key field/hint. No console errors. Screenshot.

- [ ] **Step 5:** Teardown + delete the throwaway:

```bash
lsof -ti tcp:14317 | xargs -r kill 2>/dev/null; rm -f apps/backend/src/_rendergate.ts
git status --short   # expect clean (no _rendergate.ts tracked)
```

- [ ] **Step 6:** **Device-acceptance note (user's step, not CI):** the two unverified real-CLI mechanics — (1) does `claude setup-token` accept a pasted code on stdin and store creds (vs print a token)? (2) does `@anthropic-ai/claude-agent-sdk` read `~/.claude/.credentials.json`? — are confirmed on a real device: `expo run:android` → Connections → Connect claude → complete the real sign-in → confirm status connected + a turn runs on the subscription. opencode: paste a real opencode-go key → confirm a turn runs. Record this in the handoff; do not block the merge.

- [ ] **Step 7:** Full green:

```bash
pnpm --filter @trux/backend exec vitest run \
  && pnpm --filter @trux/client exec vitest run \
  && pnpm --filter @trux/mobile test \
  && pnpm -r typecheck \
  && echo ALL GREEN
```

- [ ] **Step 8:** Merge per workflow. Use superpowers:finishing-a-development-branch to merge `feat/authenticator-phase2a` → `main` (merge when green); remove the worktree. Then update memory `trux-authenticator-oauth-first.md`: Phase 2a shipped (claude + opencode model adapters, expiry surfacing), merge commit, and the two device-acceptance unknowns; note Phase 2b (machine providers Fly/GCP + refresh) remains.

---

## Self-Review

**Spec coverage** (Phase 2 "Remaining model agents" + the chosen scope "Claude + opencode + expiry surfacing"):
- Claude via its own native login → Task 2 (`setup-token`, paste-code-back). ✓
- opencode via its own provider → Task 3 (opencode-go key in opencode's own auth.json — ToS-safe, opencode↔its own). ✓
- Same `Authenticator` interface → Task 1 (additive `submitCode`/`needsCode`, optional, doesn't disturb codex). ✓
- Same Connections screen → Task 5 (code field for needsCode, hint for apikey). ✓
- Expiry surfacing → Task 2 `status()` returns `expired` from the creds file; the type + UI already render it. ✓
- No OAuth reimplementation / no cross-routing → Claude uses claude's CLI, opencode uses opencode-go (its own); neither cross-routes. ✓
- Machine providers + deep refresh explicitly deferred to Phase 2b → scope note. ✓

**Placeholder scan:** the render-gate harness (Task 6 Step 1) says "model on the Phase 1 pattern" rather than pasting 40 lines — deliberate, it's a throwaway and the Phase 1 one is in git history; every shipped file has exact code. No TODO/TBD/"handle errors" placeholders.

**Type consistency:** `AuthMode`/`AuthStatus`/`Authenticator` extended identically in backend (`auth-provider.ts`, Task 1) and spine (`auth.ts`, Task 5) — `needsCode?: boolean` on device, `submitCode?(code)` on the interface, `submitCode(provider, code)` on `authApi`. Route paths `/auth/:provider/{begin,poll,status,disconnect,key,code}` match across route (Task 4), spine (Task 5), screen (Task 5). `submitCode` is named consistently everywhere; the `opencode-go` provider key string matches between the adapter (Task 3) and the spike's observed auth.json shape. The `AuthChild`/`SpawnFn` seam is imported from `auth-codex.ts` (not redefined) so the fake-child helper is identical across adapter tests.
