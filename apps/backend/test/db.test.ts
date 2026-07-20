import { describe, expect, it } from 'vitest'
import { openDb } from '../src/db'

describe('openDb', () => {
  it('creates the conversations and events tables', () => {
    const db = openDb(':memory:')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toContain('conversations')
    expect(tables).toContain('events')
    db.close()
  })

  it('starts with zero conversations', () => {
    const db = openDb(':memory:')
    const { n } = db.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }
    expect(n).toBe(0)
    db.close()
  })
})

describe('conversations migration', () => {
  const columns = (db: ReturnType<typeof openDb>): string[] =>
    (db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[]).map((r) => r.name)

  it('adds model and options columns', () => {
    const db = openDb(':memory:')
    const cols = columns(db)
    expect(cols).toContain('model')
    expect(cols).toContain('options')
    db.close()
  })

  it('adds trust and account_id columns', () => {
    const db = openDb(':memory:')
    const cols = columns(db)
    expect(cols).toContain('trust')
    expect(cols).toContain('account_id')
    db.close()
  })

  it('adds project_id column and projects table', () => {
    const db = openDb(':memory:')
    expect(columns(db)).toContain('project_id')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toContain('projects')
    db.close()
  })

  it('is idempotent when columns already exist', () => {
    const db = openDb(':memory:')
    expect(() => openDb(':memory:')).not.toThrow()
    expect(columns(db)).toContain('model')
    db.close()
  })
})

describe('project auto-adoption migration', () => {
  it('backfills project_id for legacy conversations, one project per distinct cwd', () => {
    // Simulate a legacy DB: open it, then insert conversations with no
    // project_id (the column exists but defaults to NULL).
    const db = openDb(':memory:')
    const now = Date.now()
    db.prepare(
      'INSERT INTO conversations (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options, trust, account_id) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL, ?, NULL, NULL)',
    ).run('c1', 'claude', '/repo/a', 'idle', now, now, '{}')
    db.prepare(
      'INSERT INTO conversations (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options, trust, account_id) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL, ?, NULL, NULL)',
    ).run('c2', 'pi', '/repo/a', 'idle', now, now, '{}')
    db.prepare(
      'INSERT INTO conversations (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options, trust, account_id) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL, ?, NULL, NULL)',
    ).run('c3', 'codex', '/repo/b', 'idle', now, now, '{}')

    // Re-open — the adoption pass runs in migrate().
    db.close()
    const db2 = openDb(':memory:')
    // Re-open doesn't carry data (in-memory). Use a file-based temp db instead.
    db2.close()

    // Use a temp file so the data persists across the reopen.
    const path = `/tmp/trux_adoption_test_${Date.now()}.db`
    const dbf = openDb(path)
    dbf.prepare(
      'INSERT INTO conversations (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options, trust, account_id) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL, ?, NULL, NULL)',
    ).run('c1', 'claude', '/repo/a', 'idle', now, now, '{}')
    dbf.prepare(
      'INSERT INTO conversations (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options, trust, account_id) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL, ?, NULL, NULL)',
    ).run('c2', 'pi', '/repo/a', 'idle', now, now, '{}')
    dbf.prepare(
      'INSERT INTO conversations (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options, trust, account_id) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL, ?, NULL, NULL)',
    ).run('c3', 'codex', '/repo/b', 'idle', now, now, '{}')
    dbf.close()

    // Reopen — adoption runs.
    const dbf2 = openDb(path)
    const rows = dbf2.prepare('SELECT id, cwd, project_id FROM conversations').all() as Array<{ id: string; cwd: string; project_id: string | null }>
    const projects = dbf2.prepare('SELECT id, name, cwd FROM projects').all() as Array<{ id: string; name: string; cwd: string }>
    dbf2.close()

    // Every conversation has a project_id now.
    expect(rows.every((r) => r.project_id !== null)).toBe(true)
    // Two distinct cwds → two projects, named after the basename.
    expect(projects).toHaveLength(2)
    const byCwd = new Map(projects.map((p) => [p.cwd, p.name]))
    expect(byCwd.get('/repo/a')).toBe('a')
    expect(byCwd.get('/repo/b')).toBe('b')
    // Both /repo/a conversations share the same project_id.
    const aRows = rows.filter((r) => r.cwd === '/repo/a')
    expect(aRows).toHaveLength(2)
    expect(aRows[0]?.project_id).toBe(aRows[1]?.project_id)
    // The /repo/b conversation has a different project_id.
    const bRow = rows.find((r) => r.cwd === '/repo/b')
    expect(bRow?.project_id).not.toBe(aRows[0]?.project_id)
  })

  it('is idempotent — a second reopen does not create duplicate projects', () => {
    const path = `/tmp/trux_adoption_idem_${Date.now()}.db`
    const now = Date.now()
    const db = openDb(path)
    db.prepare(
      'INSERT INTO conversations (id, agent, cwd, title, status, native_session_id, archived, created_at, updated_at, model, options, trust, account_id) VALUES (?, ?, ?, NULL, ?, NULL, 0, ?, ?, NULL, ?, NULL, NULL)',
    ).run('c1', 'claude', '/repo/x', 'idle', now, now, '{}')
    db.close()
    // First reopen — adopts.
    const db2 = openDb(path)
    const projectsAfter1 = (db2.prepare('SELECT count(*) AS n FROM projects').get() as { n: number }).n
    db2.close()
    // Second reopen — no-op.
    const db3 = openDb(path)
    const projectsAfter2 = (db3.prepare('SELECT count(*) AS n FROM projects').get() as { n: number }).n
    db3.close()
    expect(projectsAfter1).toBe(1)
    expect(projectsAfter2).toBe(1)
  })
})
