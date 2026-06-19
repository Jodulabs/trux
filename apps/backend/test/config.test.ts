import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, assertConfig } from '../src/config'

const KEYS = ['TRUX_HOST', 'TRUX_PORT', 'TRUX_DB_PATH', 'TRUX_SECRET', 'TRUX_AUTH', 'TRUX_WORKSPACES', 'TRUX_TAILSCALE_HOST', 'TRUX_PUSH_PRIVACY']

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
      tailscaleHost: null,
      pushPrivacy: false,
    })
  })

  it('reads TRUX_PUSH_PRIVACY', () => {
    process.env.TRUX_PUSH_PRIVACY = '1'
    expect(loadConfig().pushPrivacy).toBe(true)
  })

  it('reads TRUX_TAILSCALE_HOST', () => {
    process.env.TRUX_TAILSCALE_HOST = 'mybox.ts.net'
    expect(loadConfig().tailscaleHost).toBe('mybox.ts.net')
  })
})

describe('assertConfig', () => {
  it('throws when authRequired is true and secret is null', () => {
    expect(() => assertConfig({ host: '127.0.0.1', port: 4317, dbPath: '', secret: null, authRequired: true, workspaceRoots: [], tailscaleHost: null, pushPrivacy: false }))
      .toThrow('TRUX_AUTH=1 requires TRUX_SECRET')
  })

  it('throws when authRequired is true and secret is empty string', () => {
    expect(() => assertConfig({ host: '127.0.0.1', port: 4317, dbPath: '', secret: '', authRequired: true, workspaceRoots: [], tailscaleHost: null, pushPrivacy: false }))
      .toThrow('TRUX_AUTH=1 requires TRUX_SECRET')
  })

  it('does not throw when auth is off', () => {
    expect(() => assertConfig({ host: '127.0.0.1', port: 4317, dbPath: '', secret: null, authRequired: false, workspaceRoots: [], tailscaleHost: null, pushPrivacy: false }))
      .not.toThrow()
  })

  it('does not throw when auth is on and secret is set', () => {
    expect(() => assertConfig({ host: '127.0.0.1', port: 4317, dbPath: '', secret: 'abc', authRequired: true, workspaceRoots: [], tailscaleHost: null, pushPrivacy: false }))
      .not.toThrow()
  })
})
