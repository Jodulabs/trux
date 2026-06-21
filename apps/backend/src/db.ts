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

CREATE VIRTUAL TABLE IF NOT EXISTS fts_events
  USING fts5(conversation_id UNINDEXED, text, tokenize='unicode61');

-- Web-push subscriptions. Endpoint is the device's unique push URL (PRIMARY KEY
-- so a re-subscribe upserts rather than duplicates). A subscription is owner-wide,
-- not per-conversation: the device receives all of this owner's pushes.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Native (Expo) push tokens. The web-push protocol can't reach a native device;
-- those go through the Expo Push Service (→ APNs/FCM) keyed by an opaque Expo
-- push token. Stored alongside the browser subscriptions (same owner-wide
-- semantics) so the manager's emit path fans a notification to every device,
-- web or native. Token is the PRIMARY KEY so a re-register upserts in place.
CREATE TABLE IF NOT EXISTS expo_push_tokens (
  token       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);
`

// Forward-only column adds. SQLite has no portable ADD COLUMN IF NOT EXISTS, so
// check PRAGMA table_info first. Keep each add idempotent and ordered.
function migrate(db: TruxDatabase): void {
  const cols = new Set(
    (db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]).map((r) => r.name),
  )
  if (!cols.has('model')) db.exec('ALTER TABLE conversations ADD COLUMN model TEXT')
  if (!cols.has('options')) db.exec("ALTER TABLE conversations ADD COLUMN options TEXT NOT NULL DEFAULT '{}'")
}

export function openDb(path: string): TruxDatabase {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  return db
}
