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
  respondedWith: string[] = []
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
  respondApproval(): void {
    this.respondedWith.push('called')
  }
}

// A turn that parks on an approval_request and resumes (tool_result + complete)
// once the response arrives — needed to exercise both push notifications.
class ApprovalScriptAdapter implements AgentAdapter {
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
      nativeSessionId: () => 'sess_fake',
      respondApproval: () => answered?.(),
    }
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
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
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
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
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
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    manager.attach(conv.id, () => {})
    await manager.handleUserMessage(conv.id, 'hello')
    await manager.interrupt(conv.id)
    expect(adapter.last.interrupted).toBe(true)
  })

  it('emits awaiting_approval after an approval_request and routes the response', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'approval_request', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } },
    ])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
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
    expect(seen.at(-1)).toMatchObject({ type: 'status', state: 'thinking' })
  })

  it('passes tool_result images through and emits port_detected from output', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      {
        type: 'tool_result', tool_id: 'tu_1', status: 'ok',
        output: 'Local: http://localhost:5173/',
        images: [{ kind: 'image', media_type: 'image/png', data: 'AAAA' }],
      },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()

    const toolResult = seen.find((e) => e.type === 'tool_result') as Extract<ServerEvent, { type: 'tool_result' }>
    expect(toolResult.images?.[0]?.data).toBe('AAAA')
    const port = seen.find((e) => e.type === 'port_detected') as Extract<ServerEvent, { type: 'port_detected' }>
    expect(port.port).toBe(5173)
    expect(registry.loadTranscript(conv.id).some((s) => s.event.type === 'port_detected')).toBe(true)
  })

  it('emits port_detected only once for a repeated port', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'tool_result', tool_id: 'a', status: 'ok', output: 'localhost:5173' },
      { type: 'tool_result', tool_id: 'b', status: 'ok', output: 'still localhost:5173' },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    expect(seen.filter((e) => e.type === 'port_detected')).toHaveLength(1)
  })

  it('emits an error for a conversation whose agent has no adapter', async () => {
    const conv = registry.createConversation({ agent: 'codex', cwd: '/repo' })
    const adapter = new FakeAdapter([{ type: 'turn_complete', cost: 0 }])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    expect(seen).toEqual([
      { type: 'error', message: "no adapter for this conversation's agent", recoverable: false, seq: 0 },
    ])
    expect(manager.availableAgents()).toEqual(['claude'])
  })

  it('stamps a monotonic seq on broadcast events', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'text', text: 'hi' },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    const seqs = seen.map((e) => e.seq)
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5]) // user_text, turn_started, status, text, turn_complete, status
  })

  it('replaySince delivers only events past since_seq in one history_delta', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'text', text: 'hi' },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    manager.attach(conv.id, () => {})
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    // Simulate a reconnect that already saw up to seq 2.
    const delivered: ServerEvent[] = []
    manager.replaySince(conv.id, 2, (e) => delivered.push(e))
    expect(delivered).toHaveLength(1)
    const delta = delivered[0] as Extract<ServerEvent, { type: 'history_delta' }>
    expect(delta.type).toBe('history_delta')
    expect(delta.events.every((e) => (e.seq ?? -1) > 2)).toBe(true)
    expect(delta.events.map((e) => e.type)).toEqual(['text', 'turn_complete', 'status'])
  })

  it('dedupes a replayed user_message by client_message_id (no second turn)', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'text', text: 'hi' },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go', undefined, 'm1')
    await settle()
    // The outbox flush re-sends the same client_message_id after a reconnect.
    await manager.handleUserMessage(conv.id, 'go', undefined, 'm1')
    await settle()
    const userTexts = seen.filter((e) => e.type === 'user_text')
    expect(userTexts).toHaveLength(1) // the duplicate was dropped
  })

  it('pushes a notification on approval_request and turn_complete, deduped', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo', title: 'My repo' })
    const adapter = new ApprovalScriptAdapter()
    const notes: Array<{ kind: string; dedupeKey: string; title: string; body: string; conversationId: string }> = []
    const notifier = { notify: async (n: typeof notes[number]) => { notes.push(n) } }
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]), notifier)
    manager.attach(conv.id, () => {})
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    await manager.handleApprovalResponse(conv.id, 'tu_1', 'allow', null)
    await settle()
    // One approval push + one turn push, both tagged with the conversation.
    expect(notes.map((n) => n.kind)).toEqual(['approval', 'turn'])
    expect(notes[0]).toMatchObject({ conversationId: conv.id, title: 'My repo' })
    expect(notes[0].body).toContain('Bash')
    expect(notes[0].dedupeKey).toBe('approval:tu_1')
    expect(notes[1].dedupeKey).toMatch(/^turn:/)
  })

  it('runs without a notifier (push disabled) just fine', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([{ type: 'text', text: 'hi' }, { type: 'turn_complete', cost: 0 }])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    expect(seen.some((e) => e.type === 'turn_complete')).toBe(true)
  })

  it('idempotency survives a fresh manager via persisted history', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const script: AdapterEvent[] = [{ type: 'text', text: 'hi' }, { type: 'turn_complete', cost: 0 }]
    const m1 = new ConversationManager(registry, new Map([['claude', new FakeAdapter(script)]]))
    m1.attach(conv.id, () => {})
    await m1.handleUserMessage(conv.id, 'go', undefined, 'm1')
    await settle()
    // A new manager (process restart) seeds seenMessageIds from the transcript.
    const m2 = new ConversationManager(registry, new Map([['claude', new FakeAdapter(script)]]))
    const seen: ServerEvent[] = []
    m2.attach(conv.id, (e) => seen.push(e))
    await m2.handleUserMessage(conv.id, 'go', undefined, 'm1')
    await settle()
    expect(seen.filter((e) => e.type === 'user_text')).toHaveLength(0)
  })
})
