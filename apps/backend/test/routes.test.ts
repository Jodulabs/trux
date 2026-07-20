import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { FastifyInstance } from 'fastify'
import type { CommandsResponse, Conversation, ConversationDetail, ServerEvent } from '@trux/protocol'
import { buildServer } from '../src/server'
import { openDb, type TruxDatabase } from '../src/db'
import { SqliteRegistry } from '../src/registry'
import { ConversationManager } from '../src/manager'
import type { AdapterEvent, AgentAdapter, AgentSession } from '../src/adapter/types'
import { PushQueue } from '../src/adapter/queue'
import type { Config } from '../src/config'
import { cwdToClaudeFolder, discoverCodexSessions } from '../src/routes'

const baseConfig: Config = {
  host: '127.0.0.1', port: 0, dbPath: ':memory:', secret: 'test-secret',
  authRequired: false, workspaceRoots: [], tailscaleHost: null, pushPrivacy: false,
}

class FakeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  capabilities() {
    return { agent: 'claude' as const, models: [], defaultModel: null, controls: [] }
  }
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
      respondApproval: () => {},
    }
  }
}

// A fake whose turn parks on an approval_request and resumes once answered.
class ApprovalFakeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  capabilities() {
    return { agent: 'claude' as const, models: [], defaultModel: null, controls: [] }
  }
  start(): AgentSession {
    const outbox = new PushQueue<AdapterEvent>()
    let answered: (() => void) | null = null
    return {
      send: () => {
        outbox.push({ type: 'approval_request', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } })
        void new Promise<void>((r) => (answered = r)).then(() => {
          outbox.push({ type: 'tool_result', tool_id: 'tu_1', status: 'ok', output: 'done' })
          outbox.push({ type: 'turn_complete', cost: 0 })
          outbox.end()
        })
      },
      events: () => outbox.iterable(),
      interrupt: async () => {},
      close: async () => {},
      nativeSessionId: () => 'sess_x',
      respondApproval: () => answered?.(),
    }
  }
}

let app: FastifyInstance
let db: TruxDatabase

async function start(adapter: AgentAdapter = new FakeAdapter()): Promise<{ port: number; registry: SqliteRegistry }> {
  db = openDb(':memory:')
  const registry = new SqliteRegistry(db)
  const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
  app = await buildServer(baseConfig, db, registry, manager)
  await app.listen({ host: '127.0.0.1', port: 0 })
  return { port: (app.server.address() as AddressInfo).port, registry }
}

afterEach(async () => {
  await app?.close()
  db?.close()
})

describe('cwdToClaudeFolder', () => {
  it('converts absolute paths by replacing slashes with hyphens', () => {
    expect(cwdToClaudeFolder('/home/gp/foo')).toBe('-home-gp-foo')
    expect(cwdToClaudeFolder('/home/gp/dreamLand/jodulabs/trux')).toBe('-home-gp-dreamLand-jodulabs-trux')
  })
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

  it('creates a conversation with a pre-supplied native_session_id', async () => {
    const { port, registry } = await start()
    const created = (await (
      await fetch(`http://127.0.0.1:${port}/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'claude', cwd: '/repo', native_session_id: 'sess-xyz' }),
      })
    ).json()) as Conversation
    expect(created.native_session_id).toBe('sess-xyz')
    expect(registry.getConversation(created.id)?.native_session_id).toBe('sess-xyz')
  })

  it('creates a conversation with trust=allow_all', async () => {
    const { port, registry } = await start()
    const created = (await (
      await fetch(`http://127.0.0.1:${port}/conversations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'claude', cwd: '/repo', trust: 'allow_all' }),
      })
    ).json()) as Conversation
    expect(created.trust).toBe('allow_all')
    expect(registry.getConversation(created.id)?.trust).toBe('allow_all')
  })

  it('renames a conversation via PATCH', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const patched = (await (
      await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'My renamed convo' }),
      })
    ).json()) as Conversation
    expect(patched.title).toBe('My renamed convo')
    expect(registry.getConversation(conv.id)?.title).toBe('My renamed convo')
  })

  it('returns 400 for /sessions/discover with missing params', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/sessions/discover?agent=claude`)
    expect(res.status).toBe(400)
  })

  it('/sessions/discover for unknown agent returns 400', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/sessions/discover?agent=unknown&cwd=/repo`)
    expect(res.status).toBe(400)
  })

  it('/sessions/discover for claude returns [] when cwd has no project folder', async () => {
    const { port } = await start()
    const res = await (await fetch(`http://127.0.0.1:${port}/sessions/discover?agent=claude&cwd=/nonexistent/path`)).json()
    expect(res).toEqual([])
  })

  it('/sessions/discover for pi returns [] (on-disk format not yet covered)', async () => {
    const { port } = await start()
    const res = await (await fetch(`http://127.0.0.1:${port}/sessions/discover?agent=pi&cwd=/repo`)).json()
    expect(res).toEqual([])
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

  it('GET /catalog composes adapters + authenticators + install probe', async () => {
    // buildServer with catalog deps (adapters + authenticators) so /catalog registers.
    const localDb = openDb(':memory:')
    const localRegistry = new SqliteRegistry(localDb)
    const fakeAuth = {
      id: 'claude',
      plane: 'model' as const,
      accountKind: 'subscription' as const,
      begin: () => Promise.resolve({ mode: 'device' as const, verifyUrl: 'https://x', userCode: null }),
      poll: () => Promise.resolve('pending' as const),
      status: () => Promise.resolve('connected' as const),
      disconnect: () => Promise.resolve(),
    }
    const localApp = await buildServer(baseConfig, localDb, localRegistry,
      new ConversationManager(localRegistry, new Map([['claude', new FakeAdapter()]])),
      { authenticators: new Map([['claude', fakeAuth]]), adapters: new Map([['claude', new FakeAdapter()]]) },
    )
    const res = await localApp.inject({ method: 'GET', url: '/catalog' })
    expect(res.statusCode).toBe(200)
    const body = (res.json()) as { catalog: Array<{ agent: string; installed: boolean; runnable: boolean; accounts: Array<{ status: string; kind: string }> }> }
    expect(body.catalog).toHaveLength(1)
    expect(body.catalog[0].agent).toBe('claude')
    // installed/runnable depend on whether `claude` is on PATH in the test env.
    expect(body.catalog[0].accounts[0].kind).toBe('subscription')
    expect(body.catalog[0].accounts[0].status).toBe('connected')
    await localApp.close()
    localDb.close()
  })

  it('stores and removes a push subscription', async () => {
    const { port, registry } = await start()
    const sub = { endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }
    const ok = await fetch(`http://127.0.0.1:${port}/push/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    })
    expect(ok.status).toBe(200)
    expect(registry.listPushSubscriptions().map((s) => s.endpoint)).toEqual(['https://push/x'])

    const gone = await fetch(`http://127.0.0.1:${port}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push/x' }),
    })
    expect(gone.status).toBe(200)
    expect(registry.listPushSubscriptions()).toEqual([])
  })

  it('rejects a malformed push subscription with 400', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/push/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push/x' }),
    })
    expect(res.status).toBe(400)
  })

  it('stores and removes a native Expo push token via the same route', async () => {
    const { port, registry } = await start()
    const ok = await fetch(`http://127.0.0.1:${port}/push/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[xyz]' }),
    })
    expect(ok.status).toBe(200)
    expect(registry.listExpoPushTokens()).toEqual(['ExponentPushToken[xyz]'])
    // Web-push subscriptions are untouched by a native registration.
    expect(registry.listPushSubscriptions()).toEqual([])

    const gone = await fetch(`http://127.0.0.1:${port}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[xyz]' }),
    })
    expect(gone.status).toBe(200)
    expect(registry.listExpoPushTokens()).toEqual([])
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

  it('round-trips an approval: request → response → completion', async () => {
    const { port, registry } = await start(new ApprovalFakeAdapter())
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
    const states = events
      .filter((e): e is Extract<ServerEvent, { type: 'status' }> => e.type === 'status')
      .map((e) => e.state)
    expect(states).toEqual(['thinking', 'awaiting_approval', 'thinking', 'idle'])
  })
})

describe('git routes', () => {
  const repos: string[] = []
  afterEach(() => {
    for (const d of repos.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  function initRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'trux-gitroute-'))
    repos.push(dir)
    const g = (args: string[]): void => { execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' }) }
    g(['init', '-q'])
    g(['config', 'user.email', 'test@trux'])
    g(['config', 'user.name', 'Trux Test'])
    g(['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(dir, 'README.md'), 'hello\n')
    g(['add', '-A'])
    g(['commit', '-q', '-m', 'init'])
    return dir
  }

  it('reports status, diffs, stages, and commits a change', async () => {
    const repo = initRepo()
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: repo })
    writeFileSync(join(repo, 'README.md'), 'changed\n')

    const status = await (await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/git`)).json()
    expect(status).toMatchObject({ repo: true, dirty: true })

    const diff = await (
      await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/git/diff?path=README.md`)
    ).json() as { diff: string }
    expect(diff.diff).toContain('+changed')

    const staged = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/git/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'README.md' }),
    })
    expect(staged.status).toBe(200)

    const commit = await (
      await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/git/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'route commit' }),
      })
    ).json() as { ok: boolean; hash?: string }
    expect(commit.ok).toBe(true)
    expect(commit.hash).toMatch(/^[0-9a-f]+$/)
  })

  it('404s git status for an unknown conversation', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/conversations/nope/git`)
    expect(res.status).toBe(404)
  })

  it('400s a stage with no path', async () => {
    const repo = initRepo()
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: repo })
    const res = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/git/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('400s an unsafe diff path', async () => {
    const repo = initRepo()
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: repo })
    const res = await fetch(
      `http://127.0.0.1:${port}/conversations/${conv.id}/git/diff?path=${encodeURIComponent('../escape')}`,
    )
    expect(res.status).toBe(400)
  })
})

import { mkdtempSync as mkdtmp, mkdirSync as mkdir, writeFileSync as writeF } from 'node:fs'

describe('GET /conversations/:id/handoff', () => {
  it('404s for unknown conversation', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/conversations/nope/handoff`)
    expect(res.status).toBe(404)
  })

  it('409s when conversation is not idle', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    registry.setStatus(conv.id, 'thinking')
    const res = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/handoff`)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; status: string }
    expect(body.error).toBe('busy')
    expect(body.status).toBe('thinking')
  })

  it('422s when conversation has no native_session_id', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const res = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/handoff`)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('no native session id')
  })

  it('returns claude handoff command', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    registry.setNativeSessionId(conv.id, 'sess-abc')
    const res = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/handoff`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { agent: string; cwd: string; nativeSessionId: string; command: string[] }
    expect(body.agent).toBe('claude')
    expect(body.cwd).toBe('/repo')
    expect(body.nativeSessionId).toBe('sess-abc')
    expect(body.command).toEqual(['claude', '--resume', 'sess-abc'])
  })

  it('returns codex handoff command', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'codex', cwd: '/repo' })
    registry.setNativeSessionId(conv.id, 'tid-xyz')
    const res = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/handoff`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { command: string[] }
    expect(body.command).toEqual(['codex', 'resume', 'tid-xyz'])
  })

  it('returns pi handoff command with --session', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'pi', cwd: '/repo' })
    registry.setNativeSessionId(conv.id, 'pi-sess-9')
    const res = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/handoff`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { command: string[] }
    expect(body.command).toEqual(['pi', '--session', 'pi-sess-9'])
  })

  it('422s for unsupported agent', async () => {
    const { port, registry } = await start()
    const conv = registry.createConversation({ agent: 'opencode', cwd: '/repo' })
    registry.setNativeSessionId(conv.id, 'oc-123')
    const res = await fetch(`http://127.0.0.1:${port}/conversations/${conv.id}/handoff`)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('handoff not supported for agent: opencode')
  })
})

describe('GET /commands/discover', () => {
  function buildApp(): Promise<FastifyInstance> {
    const db = openDb(':memory:')
    const registry = new SqliteRegistry(db)
    const manager = new ConversationManager(registry, new Map([['claude', new FakeAdapter()]]))
    return buildServer(baseConfig, db, registry, manager)
  }

  it('returns discovered commands for claude', async () => {
    const cwd = mkdtmp(join(tmpdir(), 'trux-route-cmd-'))
    mkdir(join(cwd, '.claude', 'commands'), { recursive: true })
    writeF(join(cwd, '.claude', 'commands', 'review.md'), 'Review $ARGUMENTS')
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/commands/discover?agent=claude&cwd=${encodeURIComponent(cwd)}` })
    expect(res.statusCode).toBe(200)
    expect((res.json() as CommandsResponse).commands.some((c) => c.name === 'review')).toBe(true)
    await app.close()
  })

  it('400s when agent or cwd is missing', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/commands/discover?agent=claude' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns an empty list for a non-claude agent', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/commands/discover?agent=codex&cwd=/tmp' })
    expect((res.json() as CommandsResponse).commands).toEqual([])
    await app.close()
  })
})

describe('discoverCodexSessions', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  // Write a rollout file with a session_meta first line under YYYY/MM/DD.
  function writeRollout(
    root: string,
    day: string,
    name: string,
    meta: { id?: string; cwd?: string; type?: string },
  ): void {
    const dir = join(root, ...day.split('/'))
    mkdirSync(dir, { recursive: true })
    const line = JSON.stringify({ type: meta.type ?? 'session_meta', payload: { id: meta.id, cwd: meta.cwd } })
    writeFileSync(join(dir, name), `${line}\n{"type":"event"}\n`)
  }

  it('returns sessions whose session_meta cwd matches, newest first', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-codex-'))
    dirs.push(root)
    writeRollout(root, '2026/06/16', 'rollout-2026-06-16T01-00-00-aaaa.jsonl', { id: 'old', cwd: '/repo' })
    writeRollout(root, '2026/06/17', 'rollout-2026-06-17T01-00-00-bbbb.jsonl', { id: 'new', cwd: '/repo' })
    writeRollout(root, '2026/06/17', 'rollout-2026-06-17T02-00-00-cccc.jsonl', { id: 'other', cwd: '/elsewhere' })
    const found = discoverCodexSessions('/repo', root)
    expect(found.map((s) => s.sessionId)).toEqual(['new', 'old'])
  })

  it('ignores non-session_meta and malformed rollouts, and returns [] for a missing root', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-codex-'))
    dirs.push(root)
    writeRollout(root, '2026/06/17', 'rollout-2026-06-17T01-00-00-dddd.jsonl', { id: 'x', cwd: '/repo', type: 'other' })
    expect(discoverCodexSessions('/repo', root)).toEqual([])
    expect(discoverCodexSessions('/repo', join(root, 'nope'))).toEqual([])
  })
})
