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
