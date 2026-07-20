import { describe, expect, it } from 'vitest'
import type { AgentAdapter, AgentSession, AdapterEvent } from '../src/adapter/types'
import type { Authenticator, AuthMode, AuthStatus } from '../src/auth-provider'
import { buildCatalog, type ProbeFn } from '../src/catalog'
import type { AgentCapabilities, AgentName } from '@trux/protocol'
import { PushQueue } from '../src/adapter/queue'

function fakeAdapter(name: AgentName, caps?: Partial<AgentCapabilities>): AgentAdapter {
  return {
    name,
    capabilities(): AgentCapabilities {
      return { agent: name, models: [], defaultModel: null, controls: [], ...caps }
    },
    start(): AgentSession {
      const outbox = new PushQueue<AdapterEvent>()
      return {
        send: () => { outbox.push({ type: 'turn_complete', cost: null }); outbox.end() },
        events: () => outbox.iterable(),
        interrupt: async () => {},
        close: async () => {},
        nativeSessionId: () => null,
        respondApproval: () => {},
      }
    },
  }
}

function fakeAuth(overrides: Partial<Authenticator> = {}): Authenticator {
  const base: Authenticator = {
    id: 'claude',
    plane: 'model',
    accountKind: 'subscription',
    begin: () => Promise.resolve({ mode: 'device', verifyUrl: 'https://x', userCode: null } as AuthMode),
    poll: () => Promise.resolve('pending' as AuthStatus),
    status: () => Promise.resolve('connected' as AuthStatus),
    disconnect: () => Promise.resolve(),
  }
  return { ...base, ...overrides }
}

describe('buildCatalog', () => {
  it('composes adapters + authenticators into one snapshot', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([
      ['claude', fakeAdapter('claude', { models: [{ value: 'sonnet', label: 'Sonnet' }] })],
    ])
    const authenticators = new Map<string, Authenticator>([['claude', fakeAuth()]])
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog).toHaveLength(1)
    expect(catalog[0]).toEqual({
      agent: 'claude',
      installed: true,
      runnable: true,
      accounts: [{
        id: 'claude:default',
        agent: 'claude',
        label: 'Default account',
        kind: 'subscription',
        status: 'connected',
        selected: true,
      }],
      capabilities: { agent: 'claude', models: [{ value: 'sonnet', label: 'Sonnet' }], defaultModel: null, controls: [] },
    })
  })

  it('marks agent not runnable when binary is not installed', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([['claude', fakeAdapter('claude')]])
    const authenticators = new Map<string, Authenticator>([['claude', fakeAuth()]])
    const probe: ProbeFn = () => false

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog[0].installed).toBe(false)
    expect(catalog[0].runnable).toBe(false)
    expect(catalog[0].accounts[0].status).toBe('disconnected')
    expect(catalog[0].diagnostics).toContainEqual({ code: 'not_installed', message: 'claude CLI is not on PATH' })
  })

  it('marks agent not runnable when no account is connected', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([['claude', fakeAdapter('claude')]])
    const authenticators = new Map<string, Authenticator>([['claude', fakeAuth({ status: () => Promise.resolve('disconnected') })]])
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog[0].installed).toBe(true)
    expect(catalog[0].runnable).toBe(false)
    expect(catalog[0].accounts[0].status).toBe('disconnected')
    expect(catalog[0].diagnostics).toContainEqual({ code: 'no_account', message: 'No connected account for claude' })
  })

  it('agent without authenticator is runnable when installed (native credentials)', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([['pi', fakeAdapter('pi')]])
    const authenticators = new Map<string, Authenticator>()
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog[0]).toEqual({
      agent: 'pi',
      installed: true,
      runnable: true,
      accounts: [],
      capabilities: { agent: 'pi', models: [], defaultModel: null, controls: [] },
    })
    expect(catalog[0].diagnostics).toBeUndefined()
  })

  it('agent without authenticator is not runnable when not installed', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([['pi', fakeAdapter('pi')]])
    const authenticators = new Map<string, Authenticator>()
    const probe: ProbeFn = () => false

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog[0].installed).toBe(false)
    expect(catalog[0].runnable).toBe(false)
    expect(catalog[0].diagnostics).toContainEqual({ code: 'not_installed', message: 'pi CLI is not on PATH' })
  })

  it('surfaces accountKind from the authenticator (api_key vs subscription)', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([
      ['claude', fakeAdapter('claude')],
      ['opencode', fakeAdapter('opencode')],
    ])
    const authenticators = new Map<string, Authenticator>([
      ['claude', fakeAuth({ id: 'claude', accountKind: 'subscription' })],
      ['opencode', fakeAuth({ id: 'opencode', accountKind: 'api_key' })],
    ])
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    const claude = catalog.find((e) => e.agent === 'claude')
    const opencode = catalog.find((e) => e.agent === 'opencode')
    expect(claude?.accounts[0].kind).toBe('subscription')
    expect(opencode?.accounts[0].kind).toBe('api_key')
  })

  it('skips status check when binary is not installed (no wasted subprocess)', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([['claude', fakeAdapter('claude')]])
    let statusCalled = false
    const authenticators = new Map<string, Authenticator>([
      ['claude', fakeAuth({ status: () => { statusCalled = true; return Promise.resolve('connected') } })],
    ])
    const probe: ProbeFn = () => false

    await buildCatalog({ adapters, authenticators }, probe)

    expect(statusCalled).toBe(false)
  })

  it('handles authenticator status failure gracefully (disconnected)', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([['claude', fakeAdapter('claude')]])
    const authenticators = new Map<string, Authenticator>([
      ['claude', fakeAuth({ status: () => Promise.reject(new Error('boom')) })],
    ])
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog[0].accounts[0].status).toBe('disconnected')
  })

  it('composes multiple agents in adapter order', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([
      ['claude', fakeAdapter('claude')],
      ['codex', fakeAdapter('codex')],
      ['pi', fakeAdapter('pi')],
    ])
    const authenticators = new Map<string, Authenticator>([
      ['claude', fakeAuth({ id: 'claude' })],
      ['codex', fakeAuth({ id: 'codex' })],
    ])
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog.map((e) => e.agent)).toEqual(['claude', 'codex', 'pi'])
    // Pi has no authenticator → empty accounts, still runnable
    expect(catalog[2].accounts).toEqual([])
    expect(catalog[2].runnable).toBe(true)
  })

  it('Pi with a native authenticator is runnable when status=connected', async () => {
    // Phase 4: Pi has a status-only authenticator (accountKind='native').
    // The credentials are set up in Pi's desktop console; Trux only reports
    // whether they exist. Connected → runnable, like any agent.
    const adapters = new Map<AgentName, AgentAdapter>([['pi', fakeAdapter('pi')]])
    const authenticators = new Map<string, Authenticator>([
      ['pi', fakeAuth({ id: 'pi', accountKind: 'native', status: () => Promise.resolve('connected') })],
    ])
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog[0].agent).toBe('pi')
    expect(catalog[0].installed).toBe(true)
    expect(catalog[0].runnable).toBe(true)
    expect(catalog[0].accounts[0].kind).toBe('native')
    expect(catalog[0].accounts[0].status).toBe('connected')
  })

  it('Pi with a native authenticator is not runnable when status=disconnected', async () => {
    const adapters = new Map<AgentName, AgentAdapter>([['pi', fakeAdapter('pi')]])
    const authenticators = new Map<string, Authenticator>([
      ['pi', fakeAuth({ id: 'pi', accountKind: 'native', status: () => Promise.resolve('disconnected') })],
    ])
    const probe: ProbeFn = () => true

    const catalog = await buildCatalog({ adapters, authenticators }, probe)

    expect(catalog[0].runnable).toBe(false)
    expect(catalog[0].accounts[0].status).toBe('disconnected')
    expect(catalog[0].diagnostics).toContainEqual({ code: 'no_account', message: 'No connected account for pi' })
  })
})
