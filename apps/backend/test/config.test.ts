import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

const KEYS = ['TRUX_HOST', 'TRUX_PORT', 'TRUX_DB_PATH', 'TRUX_SECRET', 'TRUX_AUTH', 'TRUX_WORKSPACES']

describe('loadConfig', () => {
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
  })

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('defaults to a local, auth-optional config', () => {
    const config = loadConfig()
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4317)
    expect(config.authRequired).toBe(false)
    expect(config.secret).toBeNull()
    expect(config.dbPath).toMatch(/\.trux[/\\]trux\.db$/)
    expect(config.workspaceRoots).toEqual([])
  })

  it('reads overrides from the environment', () => {
    process.env.TRUX_HOST = '0.0.0.0'
    process.env.TRUX_PORT = '5000'
    process.env.TRUX_DB_PATH = '/tmp/x.db'
    process.env.TRUX_SECRET = 's3cret'
    process.env.TRUX_AUTH = '1'
    process.env.TRUX_WORKSPACES = '/a:/b'
    const config = loadConfig()
    expect(config).toEqual({
      host: '0.0.0.0',
      port: 5000,
      dbPath: '/tmp/x.db',
      secret: 's3cret',
      authRequired: true,
      workspaceRoots: ['/a', '/b'],
    })
  })
})
