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
