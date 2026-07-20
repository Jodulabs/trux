import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
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

-- Projects: groups conversations that share a working directory. One project
-- = one cwd (UNIQUE). Conversations reference a project via project_id; legacy
-- conversations get backfilled by the adoption migration below.
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  cwd             TEXT NOT NULL UNIQUE,
  default_agent   TEXT,
  default_trust   TEXT,
  default_model   TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
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
  // Trust extracted from opaque options (Phase 2 of the unified-controls plan):
  // trust is a Trux concept, not an agent native control, so it gets its own
  // column. Nullable; null = 'ask' (the native per-tool default).
  if (!cols.has('trust')) db.exec('ALTER TABLE conversations ADD COLUMN trust TEXT')
  // Optional account selection per conversation (Phase 3 Agent catalog). Null =
  // agent-native/default account. Forward-only; no data migration needed.
  if (!cols.has('account_id')) db.exec('ALTER TABLE conversations ADD COLUMN account_id TEXT')
  // Projects grouping (Phase 2 IA). Null = orphaned/legacy; the adoption pass
  // below backfills every existing conversation with a project derived from cwd.
  if (!cols.has('project_id')) db.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id)')

  // One-time adoption: for every conversation with no project_id, find-or-create
  // a project by cwd and stamp it. Idempotent — a second run is a no-op because
  // every adopted row has project_id set after the first pass.
  adoptConversationsIntoProjects(db)
}

function basename(path: string): string {
  const p = path.replace(/\/$/, '').split('/').pop()
  return p || path
}

function adoptConversationsIntoProjects(db: TruxDatabase): void {
  const orphans = db
    .prepare('SELECT id, cwd FROM conversations WHERE project_id IS NULL')
    .all() as Array<{ id: string; cwd: string }>
  if (orphans.length === 0) return
  const findProject = db.prepare('SELECT id FROM projects WHERE cwd = ?')
  const insertProject = db.prepare(
    'INSERT INTO projects (id, name, cwd, default_agent, default_trust, default_model, archived, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, 0, ?, ?)',
  )
  const stampConversation = db.prepare('UPDATE conversations SET project_id = ? WHERE id = ?')
  const now = Date.now()
  const tx = db.transaction(() => {
    for (const o of orphans) {
      let project = findProject.get(o.cwd) as { id: string } | undefined
      if (!project) {
        const id = `prj_${randomUUID()}`
        insertProject.run(id, basename(o.cwd), o.cwd, now, now)
        project = { id }
      }
      stampConversation.run(project.id, o.id)
    }
  })
  tx()
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
