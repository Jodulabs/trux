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
import { cwdToClaudeFolder } from '../src/routes'

const baseConfig: Config = {
  host: '127.0.0.1', port: 0, dbPath: ':memory:', secret: 'test-secret',
  authRequired: false, workspaceRoots: [], tailscaleHost: null,
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
      respondApproval: () => {},
    }
  }
}

// A fake whose turn parks on an approval_request and resumes once answered.
class ApprovalFakeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
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

  it('rejects a non-claude agent with 400', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'codex', cwd: '/repo' }),
    })
    expect(res.status).toBe(400)
  })

  it('lists available agents', async () => {
    const { port } = await start()
    const res = await (await fetch(`http://127.0.0.1:${port}/agents`)).json()
    expect(res).toEqual({ agents: ['claude'] })
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
