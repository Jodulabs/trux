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

  it('is idempotent when columns already exist', () => {
    const db = openDb(':memory:')
    expect(() => openDb(':memory:')).not.toThrow()
    expect(columns(db)).toContain('model')
    db.close()
  })
})
