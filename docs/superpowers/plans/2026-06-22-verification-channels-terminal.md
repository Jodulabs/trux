# Verification Channels — Terminal (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **terminal channel** so a developer can run commands on the box and see the output from the phone — a PTY on the box bridged to an `xterm.js` pane in the PWA, over trux's existing token-gated WebSocket.

**Architecture:** A new WebSocket route `/conversations/:id/terminal` mirrors the agent stream (`stream.ts`): auth as the first message, then a duplex byte channel. The backend bridges the socket to a `node-pty` process spawned in the conversation's `cwd`. The reusable client lives in the `@trux/client` spine (consumed by PWA today, native later); the PWA renders it with `xterm.js`. This is purely additive — the agent stream, protocol, and auth model are untouched.

**Tech Stack:** `node-pty` (native PTY), Fastify + `@fastify/websocket` (existing), the `@trux/client` spine ports, `@xterm/xterm` + `@xterm/addon-fit` (PWA), vitest (backend + spine + frontend via happy-dom).

**Scope:** Phase 1 of the verification-channels spec (`docs/superpowers/specs/2026-06-22-verification-channels-design.md`) — the **terminal** only. Web preview is Phase 2 (separate plan). The **native (Expo) terminal pane** is a deliberate follow-on (RN has no DOM `xterm`); this plan ships the channel + spine client (which native will reuse) + the PWA pane (usable on the phone via the PWA).

**Branch:** `feat/verification-terminal` (feature branch per phase, merge to main when green).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/backend/package.json` | modify | add `node-pty` dependency |
| `pnpm-workspace.yaml` | modify | allow node-pty's native build (pnpm 11 blocks build scripts) |
| `apps/backend/src/terminal.ts` | create | PTY seam (`SpawnPty`), `TerminalSession`, and the channel's wire-message types |
| `apps/backend/test/terminal.test.ts` | create | `TerminalSession` unit tests (fake pty) |
| `apps/backend/src/terminal-route.ts` | create | `wireTerminalSocket` (pure, testable) + `registerTerminal` Fastify route |
| `apps/backend/test/terminal-route.test.ts` | create | socket handler tests (fake socket + fake session) |
| `apps/backend/src/server.ts` | modify | register the terminal route alongside the stream |
| `packages/client/src/terminalClient.ts` | create | `openTerminal(id)` — WS connect, auth, duplex; reads spine ports |
| `packages/client/package.json` | modify | add the `./terminalClient` subpath export (mirror `./connectionManager`) |
| `packages/client/test/terminalClient.test.ts` | create | client tests (fake WebSocket + configured ports) |
| `apps/frontend/package.json` | modify | add `@xterm/xterm` + `@xterm/addon-fit` |
| `apps/frontend/src/components/TerminalPane.tsx` | create | xterm pane wired to `openTerminal` |
| `apps/frontend/src/components/TerminalPane.test.tsx` | create | renders + output→write + input→sendInput |
| `apps/frontend/src/components/ConversationView.tsx` | modify | a "terminal" toggle in the bar that mounts `TerminalPane` |

---

## Task 1: Add `node-pty` and allow its native build

**Files:**
- Modify: `apps/backend/package.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Add the dependency**

In `apps/backend/package.json`, add to `"dependencies"` (alphabetical, after `better-sqlite3`):

```json
    "better-sqlite3": "^12.11.1",
    "node-pty": "^1.0.0",
```

- [ ] **Step 2: Allow the native build under pnpm 11**

In `pnpm-workspace.yaml`, add `node-pty` to both build allowlists. Change:

```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
```
to:
```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
  node-pty: true
```
and change:
```yaml
onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
```
to:
```yaml
onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
  - node-pty
```

- [ ] **Step 3: Install and verify the native module loads**

Run: `pnpm install && pnpm --filter @trux/backend exec tsx -e "import('node-pty').then(p => console.log('spawn:', typeof p.spawn))"`
Expected: ends with `spawn: function` (the prebuilt/compiled binary loaded). If it fails to build, the box needs `python3`/`make`/`g++` (already required for `better-sqlite3`).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build(backend): add node-pty (allow native build) for the terminal channel"
```

---

## Task 2: `TerminalSession` — the PTY seam

**Files:**
- Create: `apps/backend/src/terminal.ts`
- Test: `apps/backend/test/terminal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/test/terminal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TerminalSession, type PtyLike, type SpawnPty } from '../src/terminal'

function fakePty() {
  let dataCb: ((d: string) => void) | null = null
  let exitCb: ((e: { exitCode: number }) => void) | null = null
  const calls = { writes: [] as string[], resized: null as [number, number] | null, killed: false }
  const pty: PtyLike = {
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb },
    write: (d) => calls.writes.push(d),
    resize: (c, r) => { calls.resized = [c, r] },
    kill: () => { calls.killed = true },
  }
  return { pty, calls, emitData: (d: string) => dataCb?.(d), emitExit: (code: number) => exitCb?.({ exitCode: code }) }
}

describe('TerminalSession', () => {
  it('spawns in the given cwd+size and bridges data/exit/write/resize/kill', () => {
    const f = fakePty()
    let spawnedWith: { cwd: string; cols: number; rows: number } | null = null
    const spawnPty: SpawnPty = (opts) => { spawnedWith = opts; return f.pty }

    const session = new TerminalSession('/work/dir', spawnPty, { cols: 100, rows: 30 })
    expect(spawnedWith).toEqual({ cwd: '/work/dir', cols: 100, rows: 30 })

    const out: string[] = []
    session.onData((d) => out.push(d))
    f.emitData('hello')
    expect(out).toEqual(['hello'])

    let exited: number | null = null
    session.onExit((code) => { exited = code })
    f.emitExit(0)
    expect(exited).toBe(0)

    session.write('ls\n')
    expect(f.calls.writes).toEqual(['ls\n'])
    session.resize(120, 40)
    expect(f.calls.resized).toEqual([120, 40])
    session.kill()
    expect(f.calls.killed).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/backend exec vitest run terminal.test.ts`
Expected: FAIL — `../src/terminal` does not exist.

- [ ] **Step 3: Implement `apps/backend/src/terminal.ts`**

```ts
import * as nodePty from 'node-pty'

// --- wire protocol: a lightweight channel, deliberately separate from
// @trux/protocol (which versions the agent conversation). ---
export type TerminalClientMsg =
  | { type: 'auth'; token: string | null }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
export type TerminalServerMsg =
  | { type: 'ready' }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string }

// --- PTY seam (injectable for tests; mirrors the codex adapter's SpawnFn). ---
export interface PtyLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}
export type SpawnPty = (opts: { cwd: string; cols: number; rows: number }) => PtyLike

const defaultSpawnPty: SpawnPty = ({ cwd, cols, rows }) =>
  nodePty.spawn(process.env.SHELL || 'bash', [], {
    name: 'xterm-color',
    cwd,
    cols,
    rows,
    env: process.env as Record<string, string>,
  }) as unknown as PtyLike

// The surface the route consumes; TerminalSession implements it, the route test fakes it.
export interface TerminalLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export class TerminalSession implements TerminalLike {
  private readonly pty: PtyLike
  constructor(cwd: string, spawnPty: SpawnPty = defaultSpawnPty, size: { cols: number; rows: number } = { cols: 80, rows: 24 }) {
    this.pty = spawnPty({ cwd, cols: size.cols, rows: size.rows })
  }
  onData(cb: (data: string) => void): void { this.pty.onData(cb) }
  onExit(cb: (code: number) => void): void { this.pty.onExit((e) => cb(e.exitCode)) }
  write(data: string): void { this.pty.write(data) }
  resize(cols: number, rows: number): void { this.pty.resize(cols, rows) }
  kill(): void { this.pty.kill() }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend exec vitest run terminal.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/terminal.ts apps/backend/test/terminal.test.ts
git commit -m "feat(terminal): TerminalSession PTY seam + wire message types"
```

---

## Task 3: Terminal WebSocket route

**Files:**
- Create: `apps/backend/src/terminal-route.ts`
- Test: `apps/backend/test/terminal-route.test.ts`
- Modify: `apps/backend/src/server.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/test/terminal-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { wireTerminalSocket, type SocketLike } from '../src/terminal-route'
import type { Config } from '../src/config'
import type { TerminalLike } from '../src/terminal'

function fakeSocket() {
  const sent: string[] = []
  let closed = false
  const handlers: Record<string, (raw?: Buffer) => void> = {}
  const socket: SocketLike = {
    send: (d) => sent.push(d),
    close: () => { closed = true },
    on: ((ev: string, cb: (raw?: Buffer) => void) => { handlers[ev] = cb }) as SocketLike['on'],
  }
  return {
    socket, sent, isClosed: () => closed,
    msg: (m: unknown) => handlers.message?.(Buffer.from(JSON.stringify(m))),
    fireClose: () => handlers.close?.(),
    types: () => sent.map((s) => JSON.parse(s).type as string),
  }
}

function fakeSession() {
  let dataCb: ((d: string) => void) | null = null
  let exitCb: ((c: number) => void) | null = null
  const calls = { writes: [] as string[], resized: null as [number, number] | null, killed: false }
  const session: TerminalLike = {
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb },
    write: (d) => calls.writes.push(d),
    resize: (c, r) => { calls.resized = [c, r] },
    kill: () => { calls.killed = true },
  }
  return { session, calls, emitData: (d: string) => dataCb?.(d), emitExit: (c: number) => exitCb?.(c) }
}

const cfg = { authRequired: true, secret: 'sekret' } as unknown as Config

describe('wireTerminalSocket', () => {
  it('rejects a non-auth first message and closes', () => {
    const s = fakeSocket()
    wireTerminalSocket(s.socket, 'c1', { config: cfg, cwdForConversation: () => '/w', makeSession: () => fakeSession().session })
    s.msg({ type: 'input', data: 'x' })
    expect(s.types()).toContain('error')
    expect(s.isClosed()).toBe(true)
  })

  it('rejects a bad token', () => {
    const s = fakeSocket()
    wireTerminalSocket(s.socket, 'c1', { config: cfg, cwdForConversation: () => '/w', makeSession: () => fakeSession().session })
    s.msg({ type: 'auth', token: 'wrong' })
    expect(JSON.parse(s.sent[0]).message).toBe('unauthorized')
    expect(s.isClosed()).toBe(true)
  })

  it('closes on an unknown conversation', () => {
    const s = fakeSocket()
    wireTerminalSocket(s.socket, 'nope', { config: cfg, cwdForConversation: () => null, makeSession: () => fakeSession().session })
    s.msg({ type: 'auth', token: 'sekret' })
    expect(JSON.parse(s.sent[0]).message).toBe('unknown conversation')
    expect(s.isClosed()).toBe(true)
  })

  it('after auth: sends ready, forwards output, writes input, resizes, kills on close', () => {
    const s = fakeSocket()
    const f = fakeSession()
    wireTerminalSocket(s.socket, 'c1', { config: cfg, cwdForConversation: () => '/work', makeSession: () => f.session })
    s.msg({ type: 'auth', token: 'sekret' })
    expect(s.types()).toContain('ready')

    f.emitData('out!')
    expect(s.sent.map((x) => JSON.parse(x)).find((m) => m.type === 'output')?.data).toBe('out!')

    s.msg({ type: 'input', data: 'ls\n' })
    expect(f.calls.writes).toEqual(['ls\n'])
    s.msg({ type: 'resize', cols: 100, rows: 40 })
    expect(f.calls.resized).toEqual([100, 40])

    s.fireClose()
    expect(f.calls.killed).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/backend exec vitest run terminal-route.test.ts`
Expected: FAIL — `../src/terminal-route` does not exist.

- [ ] **Step 3: Implement `apps/backend/src/terminal-route.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import { tokenAccepted } from './auth'
import { TerminalSession, type TerminalLike, type TerminalClientMsg, type TerminalServerMsg } from './terminal'

// Minimal socket surface so the handler is unit-testable without a real WS.
// The real @fastify/websocket socket is cast to this (see registerTerminal).
export interface SocketLike {
  send(data: string): void
  close(): void
  on(event: 'message' | 'close', cb: (raw: Buffer) => void): void
}

export interface TerminalDeps {
  config: Config
  cwdForConversation: (id: string) => string | null
  makeSession: (cwd: string) => TerminalLike
}

function parse(raw: string): TerminalClientMsg | null {
  try {
    const m = JSON.parse(raw) as TerminalClientMsg
    if (m && typeof (m as { type?: unknown }).type === 'string') return m
  } catch { /* fall through */ }
  return null
}

// Auth-as-first-message, mirroring stream.ts. Spawns the PTY only after a valid
// token + a known conversation; kills it when the socket closes.
export function wireTerminalSocket(socket: SocketLike, id: string, deps: TerminalDeps): void {
  const send = (msg: TerminalServerMsg): void => socket.send(JSON.stringify(msg))
  let session: TerminalLike | null = null
  let authed = false

  socket.on('close', () => session?.kill())

  socket.on('message', (raw: Buffer) => {
    const msg = parse(raw.toString())
    if (!msg) { send({ type: 'error', message: 'invalid message' }); return }

    if (!authed) {
      if (msg.type !== 'auth') { send({ type: 'error', message: 'auth required as first message' }); socket.close(); return }
      if (!tokenAccepted(deps.config, msg.token)) { send({ type: 'error', message: 'unauthorized' }); socket.close(); return }
      const cwd = deps.cwdForConversation(id)
      if (!cwd) { send({ type: 'error', message: 'unknown conversation' }); socket.close(); return }
      authed = true
      session = deps.makeSession(cwd)
      session.onData((data) => send({ type: 'output', data }))
      session.onExit((code) => { send({ type: 'exit', code }); socket.close() })
      send({ type: 'ready' })
      return
    }

    if (msg.type === 'input') session?.write(msg.data)
    else if (msg.type === 'resize') session?.resize(msg.cols, msg.rows)
  })
}

export function registerTerminal(app: FastifyInstance, config: Config, registry: SqliteRegistry): void {
  app.register(async (scope) => {
    scope.get('/conversations/:id/terminal', { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string }
      wireTerminalSocket(socket as unknown as SocketLike, id, {
        config,
        cwdForConversation: (cid) => registry.getConversation(cid)?.cwd ?? null,
        makeSession: (cwd) => new TerminalSession(cwd),
      })
    })
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @trux/backend exec vitest run terminal-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the route into the server**

In `apps/backend/src/server.ts`, add the import next to the others:

```ts
import { registerStream } from './stream'
import { registerTerminal } from './terminal-route'
```

and register it right after `registerStream(app, config, registry, manager)`:

```ts
  registerStream(app, config, registry, manager)
  registerTerminal(app, config, registry)
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @trux/backend typecheck`
Expected: clean.

```bash
git add apps/backend/src/terminal-route.ts apps/backend/test/terminal-route.test.ts apps/backend/src/server.ts
git commit -m "feat(terminal): /conversations/:id/terminal WS route (auth-first, cwd-scoped PTY)"
```

---

## Task 4: Spine terminal client

**Files:**
- Create: `packages/client/src/terminalClient.ts`
- Modify: `packages/client/package.json`
- Test: `packages/client/test/terminalClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/client/test/terminalClient.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { configureClient } from '../src/ports'
import { openTerminal } from '../src/terminalClient'

class FakeWS {
  static OPEN = 1
  readonly OPEN = 1
  readyState = 1
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  constructor(url: string) { this.url = url; created = this }
  send(d: string) { this.sent.push(d) }
  close() {}
  fireOpen() { this.onopen?.() }
  fireMessage(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}
let created: FakeWS | null = null

beforeEach(() => {
  created = null
  const store = new Map<string, string>([['trux_token', 'sekret']])
  configureClient({
    storage: { get: (k) => store.get(k) ?? null, set: () => {}, remove: () => {} },
    serverConfig: { httpBase: '', wsBase: 'ws://box' },
  })
})

describe('openTerminal', () => {
  it('connects to the terminal URL and authenticates on open', () => {
    openTerminal('c1', { WebSocketImpl: FakeWS as never })
    expect(created!.url).toBe('ws://box/conversations/c1/terminal')
    created!.fireOpen()
    expect(JSON.parse(created!.sent[0])).toEqual({ type: 'auth', token: 'sekret' })
  })

  it('dispatches output and frames input/resize', () => {
    const handle = openTerminal('c1', { WebSocketImpl: FakeWS as never })
    created!.fireOpen()
    const out: string[] = []
    handle.onOutput((d) => out.push(d))
    created!.fireMessage({ type: 'output', data: 'hi' })
    expect(out).toEqual(['hi'])
    handle.sendInput('ls\n')
    handle.sendResize(80, 24)
    expect(created!.sent.slice(1).map((s) => JSON.parse(s))).toEqual([
      { type: 'input', data: 'ls\n' },
      { type: 'resize', cols: 80, rows: 24 },
    ])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/client exec vitest run terminalClient.test.ts`
Expected: FAIL — `../src/terminalClient` does not exist.

- [ ] **Step 3: Implement `packages/client/src/terminalClient.ts`**

```ts
import { getServerConfig, getStorage } from './ports'

export interface TerminalHandle {
  onOutput(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
  onError(cb: (message: string) => void): void
  sendInput(data: string): void
  sendResize(cols: number, rows: number): void
  close(): void
}

type WsCtor = new (url: string) => WebSocket

// Opens the terminal channel for a conversation. Token + wsBase come from the
// injected ports (same source as openConnection); WebSocketImpl is injectable for tests.
export function openTerminal(conversationId: string, opts: { WebSocketImpl?: WsCtor } = {}): TerminalHandle {
  const WS = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WsCtor)
  const token = getStorage().get('trux_token') ?? null
  const wsBase = getServerConfig().wsBase
  const ws = new WS(`${wsBase}/conversations/${conversationId}/terminal`)

  const outputCbs: ((d: string) => void)[] = []
  const exitCbs: ((code: number) => void)[] = []
  const errorCbs: ((m: string) => void)[] = []

  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }))
  ws.onmessage = (ev: MessageEvent) => {
    let msg: { type?: string; data?: string; code?: number; message?: string }
    try { msg = JSON.parse(String(ev.data)) } catch { return }
    if (msg.type === 'output' && typeof msg.data === 'string') for (const cb of outputCbs) cb(msg.data)
    else if (msg.type === 'exit') for (const cb of exitCbs) cb(msg.code ?? 0)
    else if (msg.type === 'error' && typeof msg.message === 'string') for (const cb of errorCbs) cb(msg.message)
  }

  const sendJSON = (m: unknown): void => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }

  return {
    onOutput: (cb) => outputCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb),
    onError: (cb) => errorCbs.push(cb),
    sendInput: (data) => sendJSON({ type: 'input', data }),
    sendResize: (cols, rows) => sendJSON({ type: 'resize', cols, rows }),
    close: () => ws.close(),
  }
}
```

- [ ] **Step 4: Add the subpath export**

In `packages/client/package.json`, find the `"exports"` map and add a `./terminalClient` entry **mirroring the existing `./connectionManager` entry** (same shape — `types`/`import` pointing at `terminalClient` instead of `connectionManager`). This is what lets `@trux/client/terminalClient` resolve, exactly like `@trux/client/connectionManager` does today.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @trux/client exec vitest run terminalClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @trux/client typecheck`
Expected: clean.

```bash
git add packages/client/src/terminalClient.ts packages/client/package.json packages/client/test/terminalClient.test.ts
git commit -m "feat(client): openTerminal spine client for the terminal channel"
```

---

## Task 5: PWA terminal pane

**Files:**
- Modify: `apps/frontend/package.json`
- Create: `apps/frontend/src/components/TerminalPane.tsx`
- Test: `apps/frontend/src/components/TerminalPane.test.tsx`
- Modify: `apps/frontend/src/components/ConversationView.tsx`

- [ ] **Step 1: Add the xterm dependencies**

In `apps/frontend/package.json`, add to `"dependencies"`:

```json
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
```

Run: `pnpm install`
Expected: installs cleanly.

- [ ] **Step 2: Write the failing test**

Create `apps/frontend/src/components/TerminalPane.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// Capture the openTerminal handle so the test can drive it.
const handle = {
  outputCb: null as null | ((d: string) => void),
  inputs: [] as string[],
  resizes: [] as [number, number][],
  closed: false,
  onOutput(cb: (d: string) => void) { this.outputCb = cb },
  onExit() {},
  onError() {},
  sendInput(d: string) { this.inputs.push(d) },
  sendResize(c: number, r: number) { this.resizes.push([c, r]) },
  close() { this.closed = true },
}
vi.mock('@trux/client/terminalClient', () => ({ openTerminal: vi.fn(() => handle) }))

// Minimal xterm + fit-addon stubs.
let termInstance: { written: string[]; dataCb: ((d: string) => void) | null; cols: number; rows: number }
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: unknown) {
    termInstance = { written: [], dataCb: null, cols: 80, rows: 24 }
    return {
      loadAddon: () => {},
      open: () => {},
      write: (d: string) => termInstance.written.push(d),
      onData: (cb: (d: string) => void) => { termInstance.dataCb = cb; return { dispose: () => {} } },
      dispose: () => {},
      get cols() { return termInstance.cols },
      get rows() { return termInstance.rows },
    }
  }),
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn(() => ({ fit: () => {} })) }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

import { openTerminal } from '@trux/client/terminalClient'
import { TerminalPane } from './TerminalPane'

beforeEach(() => { handle.inputs = []; handle.resizes = []; handle.outputCb = null })

describe('TerminalPane', () => {
  it('opens the terminal for the conversation and wires output→write and input→sendInput', () => {
    render(<TerminalPane conversationId="c1" />)
    expect(openTerminal).toHaveBeenCalledWith('c1')

    handle.outputCb?.('boot\n')
    expect(termInstance.written).toContain('boot\n')

    termInstance.dataCb?.('echo hi\n')
    expect(handle.inputs).toEqual(['echo hi\n'])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @trux/frontend exec vitest run TerminalPane.test.tsx`
Expected: FAIL — `./TerminalPane` does not exist.

- [ ] **Step 4: Implement `apps/frontend/src/components/TerminalPane.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { openTerminal } from '@trux/client/terminalClient'
import '@xterm/xterm/css/xterm.css'

// A live terminal on the box, in the conversation's cwd. Mounts an xterm, bridges
// it to the spine's openTerminal channel, and tears both down on unmount.
export function TerminalPane({ conversationId }: { conversationId: string }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const term = new Terminal({ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, convertEol: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    const handle = openTerminal(conversationId)
    handle.onOutput((data) => term.write(data))
    handle.onExit(() => term.write('\r\n[process exited]\r\n'))
    const onData = term.onData((data) => handle.sendInput(data))
    handle.sendResize(term.cols, term.rows)

    const onResize = (): void => { fit.fit(); handle.sendResize(term.cols, term.rows) }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      onData.dispose()
      handle.close()
      term.dispose()
    }
  }, [conversationId])

  return <div className="terminal-pane" ref={ref} data-testid="terminal-pane" />
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @trux/frontend exec vitest run TerminalPane.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Mount a terminal toggle in `ConversationView`**

In `apps/frontend/src/components/ConversationView.tsx`:

Add the import after the `Composer` import (line 13):
```tsx
import { Composer } from './Composer'
import { TerminalPane } from './TerminalPane'
```

Add toggle state next to the other `useState` hooks (after line 73, `const [atBottom, setAtBottom] = useState(true)`):
```tsx
  const [atBottom, setAtBottom] = useState(true)
  const [showTerminal, setShowTerminal] = useState(false)
```

In the `conversation-bar` block, add a toggle button right after the `open-preview` button block (after line 244, the closing `) : null}` of the preview button):
```tsx
        <button
          className="open-terminal"
          data-testid="toggle-terminal"
          onClick={() => setShowTerminal((v) => !v)}
        >
          ⌗ terminal
        </button>
```

Mount the pane between the `transcript-area` div and the `pendingApproval` block (after line 260, the closing `</div>` of `transcript-area`):
```tsx
      </div>
      {showTerminal ? (
        <div className="terminal-area" data-testid="terminal-area">
          <TerminalPane conversationId={id} />
        </div>
      ) : null}
```

- [ ] **Step 7: Typecheck + regression + commit**

Run: `pnpm --filter @trux/frontend exec vitest run && pnpm --filter @trux/frontend typecheck`
Expected: all frontend tests pass (existing + the new one), typecheck clean.

```bash
git add apps/frontend/package.json apps/frontend/src/components/TerminalPane.tsx apps/frontend/src/components/TerminalPane.test.tsx apps/frontend/src/components/ConversationView.tsx pnpm-lock.yaml
git commit -m "feat(frontend): terminal pane (xterm) with a toggle in the conversation bar"
```

---

## Task 6: Finish the branch

- [ ] **Step 1: Full green check**

Run:
```bash
pnpm --filter @trux/backend exec vitest run \
  && pnpm --filter @trux/client exec vitest run \
  && pnpm --filter @trux/frontend exec vitest run \
  && pnpm -r typecheck
```
Expected: backend, client, and frontend suites all pass; typecheck clean. (Run the mobile suite separately if needed — it is unaffected by this change and known to be contention-flaky in the all-packages run.)

- [ ] **Step 2: Manual smoke (optional, real PTY)**

With the backend running locally, open the PWA, tap **⌗ terminal**, run `pwd` — it prints the conversation's cwd; resize the window and confirm the shell reflows. Confirms node-pty + the route + the pane end-to-end.

- [ ] **Step 3: Merge per project workflow**

Use superpowers:finishing-a-development-branch to merge `feat/verification-terminal` → `main` (merge when green), matching the established phase workflow.

---

## Self-Review

**Spec coverage** (against `2026-06-22-verification-channels-design.md`, Phase 1 — terminal):
- WS route `/conversations/:id/terminal` mirroring `stream.ts`, auth-first → Task 3 (`wireTerminalSocket` + the auth-first test). ✓
- `node-pty` in the conversation's `cwd` → Task 1 (dep) + Task 2 (`TerminalSession`) + Task 3 (cwd from `registry.getConversation(id).cwd`). ✓
- Reuse `tokenAccepted`; "auth boundary is the RCE boundary" → Task 3 (token gate before any PTY spawn). ✓
- `resize` control + kill on close → Task 2/3 (resize forwarded, `session.kill()` on `close`). ✓
- xterm.js pane on the phone (PWA) → Task 5. ✓
- Reusable spine client (native will consume) → Task 4. ✓
- Out of scope, per spec/plan: web preview (Phase 2, separate plan) and the **native Expo terminal pane** (RN has no DOM xterm — follow-on). Flagged in the header. ✓

**Placeholder scan:** no TBD/TODO/"handle edge cases". The one prose instruction (Task 4 Step 4: "mirror the `./connectionManager` export") points at a concrete existing entry to copy, not an invented shape. ✓

**Type/name consistency:** wire types `TerminalClientMsg`/`TerminalServerMsg` (`auth`/`input`/`resize` ↔ `ready`/`output`/`exit`/`error`) are identical across `terminal.ts` (producer), `terminal-route.ts` (server), and `terminalClient.ts` (client). `TerminalLike` (onData/onExit/write/resize/kill) is implemented by `TerminalSession` (Task 2) and consumed by `wireTerminalSocket`'s `makeSession` (Task 3) and faked in both tests. `openTerminal(id, { WebSocketImpl })` and its `TerminalHandle` (onOutput/onExit/onError/sendInput/sendResize/close) match between Task 4's impl, its test, and the `TerminalPane` consumer in Task 5. ✓
