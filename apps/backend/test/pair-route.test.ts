import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../src/server'
import { openDb, type TruxDatabase } from '../src/db'
import { SqliteRegistry } from '../src/registry'
import { ConversationManager } from '../src/manager'
import type { Config } from '../src/config'
import { writePairCode } from '../src/pair-code'

const baseConfig: Config = {
  host: '127.0.0.1',
  port: 0,
  dbPath: ':memory:',
  secret: 'test-secret',
  authRequired: false,
  workspaceRoots: [],
  tailscaleHost: null,
  pushPrivacy: false,
}

let app: FastifyInstance
let db: TruxDatabase
let home: string

afterEach(async () => {
  await app?.close()
  db?.close()
  if (home) rmSync(home, { recursive: true, force: true })
})

describe('GET /p/:code', () => {
  it('redirects a live code to /#token=…', async () => {
    home = mkdtempSync(join(tmpdir(), 'trux-pair-route-'))
    writePairCode({ home, code: 'TESTCODE' })
    const prev = process.env.HOME
    process.env.HOME = home
    try {
      db = openDb(':memory:')
      const registry = new SqliteRegistry(db)
      const manager = new ConversationManager(registry, new Map())
      app = await buildServer(baseConfig, db, registry, manager)
      const res = await app.inject({ method: 'GET', url: '/p/TESTCODE' })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/#token=test-secret')
    } finally {
      process.env.HOME = prev
    }
  })

  it('returns 404 for unknown or expired codes', async () => {
    home = mkdtempSync(join(tmpdir(), 'trux-pair-route-'))
    const prev = process.env.HOME
    process.env.HOME = home
    try {
      db = openDb(':memory:')
      const registry = new SqliteRegistry(db)
      const manager = new ConversationManager(registry, new Map())
      app = await buildServer(baseConfig, db, registry, manager)
      const res = await app.inject({ method: 'GET', url: '/p/NOSUCHXX' })
      expect(res.statusCode).toBe(404)
    } finally {
      process.env.HOME = prev
    }
  })

  it('returns 404 when auth secret is missing', async () => {
    home = mkdtempSync(join(tmpdir(), 'trux-pair-route-'))
    writePairCode({ home, code: 'TESTCODE' })
    const prev = process.env.HOME
    process.env.HOME = home
    try {
      db = openDb(':memory:')
      const registry = new SqliteRegistry(db)
      const manager = new ConversationManager(registry, new Map())
      app = await buildServer({ ...baseConfig, secret: null }, db, registry, manager)
      const res = await app.inject({ method: 'GET', url: '/p/TESTCODE' })
      expect(res.statusCode).toBe(404)
    } finally {
      process.env.HOME = prev
    }
  })
})
