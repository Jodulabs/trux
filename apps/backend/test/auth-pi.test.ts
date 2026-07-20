import { describe, expect, it } from 'vitest'
import { PiAuthenticator, piStatusFromAuthFile, type PiAuthFile } from '../src/auth-pi'

function authFile(entries: Record<string, PiAuthFile[string]>): PiAuthFile {
  return entries
}

describe('piStatusFromAuthFile', () => {
  it('connected when an oauth entry has a non-expired access token', () => {
    const file = authFile({
      'openai-codex': { type: 'oauth', access: 'tok', expires: Date.now() + 10_000 },
    })
    expect(piStatusFromAuthFile(file, {})).toBe('connected')
  })

  it('disconnected when the only oauth token is expired', () => {
    const file = authFile({
      'openai-codex': { type: 'oauth', access: 'tok', expires: Date.now() - 10_000 },
    })
    expect(piStatusFromAuthFile(file, {})).toBe('disconnected')
  })

  it('connected when an api_key entry has a non-empty key', () => {
    const file = authFile({ 'opencode-go': { type: 'api_key', key: 'sk-abc' } })
    expect(piStatusFromAuthFile(file, {})).toBe('connected')
  })

  it('disconnected when an api_key entry has an empty key', () => {
    const file = authFile({ 'opencode-go': { type: 'api_key', key: '' } })
    expect(piStatusFromAuthFile(file, {})).toBe('disconnected')
  })

  it('connected when a recognized env var is set, even with no auth file entries', () => {
    expect(piStatusFromAuthFile({}, { ANTHROPIC_API_KEY: 'sk-abc' })).toBe('connected')
    expect(piStatusFromAuthFile({}, { OPENAI_API_KEY: 'sk-abc' })).toBe('connected')
    expect(piStatusFromAuthFile({}, { GEMINI_API_KEY: 'x' })).toBe('connected')
  })

  it('disconnected when env vars are present but empty', () => {
    expect(piStatusFromAuthFile({}, { ANTHROPIC_API_KEY: '' })).toBe('disconnected')
    expect(piStatusFromAuthFile({}, { ANTHROPIC_API_KEY: undefined })).toBe('disconnected')
  })

  it('disconnected when auth file is empty and no env vars are set', () => {
    expect(piStatusFromAuthFile({}, {})).toBe('disconnected')
  })

  it('skips expired oauth but still returns connected if another entry is valid', () => {
    const file = authFile({
      'expired': { type: 'oauth', access: 'old', expires: Date.now() - 1 },
      'fresh': { type: 'api_key', key: 'sk-new' },
    })
    expect(piStatusFromAuthFile(file, {})).toBe('connected')
  })
})

describe('PiAuthenticator', () => {
  it('accountKind is native (Pi owns the credential store)', () => {
    const auth = new PiAuthenticator({ read: () => ({}) }, {})
    expect(auth.accountKind).toBe('native')
  })

  it('status reports connected when auth file has a valid oauth entry', async () => {
    const fs = {
      read: () => authFile({ 'openai-codex': { type: 'oauth', access: 'tok', expires: Date.now() + 10_000 } }),
    }
    const auth = new PiAuthenticator(fs, {})
    expect(await auth.status()).toBe('connected')
  })

  it('status reports disconnected when nothing is set up', async () => {
    const auth = new PiAuthenticator({ read: () => ({}) }, {})
    expect(await auth.status()).toBe('disconnected')
  })

  it('status reports connected when env var is set but auth file is empty', async () => {
    const auth = new PiAuthenticator({ read: () => ({}) }, { OPENAI_API_KEY: 'sk-x' })
    expect(await auth.status()).toBe('connected')
  })

  it('begin returns apikey mode with a label explaining desktop setup', async () => {
    const auth = new PiAuthenticator({ read: () => ({}) }, {})
    const mode = await auth.begin()
    expect(mode.mode).toBe('apikey')
    if (mode.mode === 'apikey') {
      expect(mode.label).toMatch(/box/i)
    }
  })

  it('poll mirrors status (no in-flight login)', async () => {
    const fs = {
      read: () => authFile({ 'opencode-go': { type: 'api_key', key: 'sk-x' } }),
    }
    const auth = new PiAuthenticator(fs, {})
    expect(await auth.poll()).toBe('connected')
  })

  it('disconnect is a no-op (Trux does not own Pi credentials)', async () => {
    const auth = new PiAuthenticator({ read: () => ({}) }, {})
    await expect(auth.disconnect()).resolves.toBeUndefined()
  })

  it('auth file parsed with Object.create(null) — __proto__ does not pollute', () => {
    // A malicious auth.json with a __proto__ key must not pollute Object.prototype.
    // The defaultFs.read() uses Object.create(null); the test here exercises the
    // pure function path with a null-prototype object.
    const file = Object.create(null) as PiAuthFile
    file['openai'] = { type: 'api_key', key: 'sk-x' }
    file['__proto__'] = { type: 'pollution', key: 'evil' } as unknown as PiAuthFile[string]
    expect(piStatusFromAuthFile(file, {})).toBe('connected')
    // Object.prototype must not be polluted.
    expect(({} as Record<string, unknown>).type).toBeUndefined()
  })
})
