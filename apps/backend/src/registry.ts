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

// Extract searchable text from an event for FTS indexing.
function ftsText(event: ServerEvent): string | null {
  if (event.type === 'user_text') return event.text
  if (event.type === 'text') return event.text
  if (event.type === 'tool_result') return event.output
  return null
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
      native_session_id: input.native_session_id ?? null,
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

  renameConversation(id: string, title: string): void {
    this.db
      .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id)
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
    // Index searchable event types into FTS5.
    const text = ftsText(event)
    if (text) {
      this.db
        .prepare('INSERT INTO fts_events (conversation_id, text) VALUES (?, ?)')
        .run(convId, text)
    }
    return { seq: next, event }
  }

  loadTranscript(convId: string): StoredEvent[] {
    return (
      this.db
        .prepare('SELECT seq, payload FROM events WHERE conversation_id = ? ORDER BY seq')
        .all(convId) as { seq: number; payload: string }[]
    ).map((r) => ({ seq: r.seq, event: JSON.parse(r.payload) as ServerEvent }))
  }

  // Events with seq > sinceSeq, for replaying what a reconnecting client missed.
  // Filtered in SQL so a long transcript isn't fully materialized per reconnect.
  loadTranscriptSince(convId: string, sinceSeq: number): StoredEvent[] {
    return (
      this.db
        .prepare('SELECT seq, payload FROM events WHERE conversation_id = ? AND seq > ? ORDER BY seq')
        .all(convId, sinceSeq) as { seq: number; payload: string }[]
    ).map((r) => ({ seq: r.seq, event: JSON.parse(r.payload) as ServerEvent }))
  }

  // The client_message_ids already persisted for a conversation — seeds the
  // manager's idempotency set so a reconnect flush can't replay a processed turn
  // even across a process restart.
  seenMessageIds(convId: string): string[] {
    const rows = this.db
      .prepare("SELECT payload FROM events WHERE conversation_id = ? AND type = 'user_text'")
      .all(convId) as { payload: string }[]
    const ids: string[] = []
    for (const r of rows) {
      const id = (JSON.parse(r.payload) as { client_message_id?: string }).client_message_id
      if (id) ids.push(id)
    }
    return ids
  }

  searchConversations(q: string): Array<{ conversation: Conversation; snippet: string }> {
    // snippet() is an FTS5 auxiliary function — cannot be used with GROUP BY.
    // Fetch up to 100 raw matches, then deduplicate by conversation_id in JS.
    const rows = this.db
      .prepare(
        `SELECT f.conversation_id,
                snippet(fts_events, 1, '<b>', '</b>', '…', 8) AS snippet
         FROM fts_events f
         WHERE f.text MATCH ?
         LIMIT 100`,
      )
      .all(`"${q.replace(/"/g, '""')}"`) as Array<{ conversation_id: string; snippet: string }>
    const seen = new Set<string>()
    const results: Array<{ conversation: Conversation; snippet: string }> = []
    for (const r of rows) {
      if (seen.has(r.conversation_id)) continue
      seen.add(r.conversation_id)
      const conversation = this.getConversation(r.conversation_id)
      if (conversation) results.push({ conversation, snippet: r.snippet })
      if (results.length >= 20) break
    }
    return results
  }
}
