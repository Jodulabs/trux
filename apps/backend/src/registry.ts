import { randomUUID } from 'node:crypto'
import type {
  AgentName,
  Conversation,
  ConversationStatus,
  CreateConversationRequest,
  ServerEvent,
  StoredEvent,
} from '@trux/protocol'
import type { TruxDatabase } from './db'

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
}

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
  }
}

// Owns the conversations + events tables: lifecycle, status mirror, and the
// append-only transcript with per-conversation seq allocation.
export class SqliteRegistry {
  constructor(private readonly db: TruxDatabase) {}

  createConversation(input: CreateConversationRequest): Conversation {
    const now = Date.now()
    const row: ConversationRow = {
      id: randomUUID(),
      agent: input.agent,
      cwd: input.cwd,
      title: input.title ?? null,
      status: 'idle',
      native_session_id: null,
      archived: 0,
      created_at: now,
      updated_at: now,
    }
    this.db
      .prepare(
        `INSERT INTO conversations
         (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at)
         VALUES (@id, @agent, @cwd, @title, @status, @native_session_id, @archived, @created_at, @updated_at)`,
      )
      .run(row)
    return toConversation(row)
  }

  listConversations(): Conversation[] {
    return (
      this.db
        .prepare('SELECT * FROM conversations WHERE archived = 0 ORDER BY updated_at DESC')
        .all() as ConversationRow[]
    ).map(toConversation)
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | ConversationRow
      | undefined
    return row ? toConversation(row) : null
  }

  setStatus(id: string, status: ConversationStatus): void {
    this.db
      .prepare('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
  }

  setNativeSessionId(id: string, nativeSessionId: string): void {
    this.db
      .prepare('UPDATE conversations SET native_session_id = ?, updated_at = ? WHERE id = ?')
      .run(nativeSessionId, Date.now(), id)
  }

  archiveConversation(id: string): void {
    this.db
      .prepare('UPDATE conversations SET archived = 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id)
  }

  appendEvent(convId: string, event: ServerEvent): StoredEvent {
    const { next } = this.db
      .prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM events WHERE conversation_id = ?')
      .get(convId) as { next: number }
    this.db
      .prepare(
        'INSERT INTO events (conversation_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(convId, next, event.type, JSON.stringify(event), Date.now())
    return { seq: next, event }
  }

  loadTranscript(convId: string): StoredEvent[] {
    return (
      this.db
        .prepare('SELECT seq, payload FROM events WHERE conversation_id = ? ORDER BY seq')
        .all(convId) as { seq: number; payload: string }[]
    ).map((r) => ({ seq: r.seq, event: JSON.parse(r.payload) as ServerEvent }))
  }
}
