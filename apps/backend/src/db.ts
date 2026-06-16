import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type TruxDatabase = Database.Database

// The ConversationRegistry store: a conversations table plus an append-only,
// ordered events table (the normalized transcript). Schema is created here so the
// box is ready for Phase 1; Phase 0 only proves init + round-trip.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id                 TEXT PRIMARY KEY,
  agent              TEXT NOT NULL,
  cwd                TEXT NOT NULL,
  title              TEXT,
  status             TEXT NOT NULL DEFAULT 'idle',
  native_session_id  TEXT,
  archived           INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id),
  seq              INTEGER NOT NULL,
  type             TEXT NOT NULL,
  payload          TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_conversation
  ON events (conversation_id, seq);
`

export function openDb(path: string): TruxDatabase {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
