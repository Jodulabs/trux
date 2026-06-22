import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { parseClaudeSetupOutput, parseClaudeStatus } from '../src/auth-provider'
import { ClaudeAuthenticator } from '../src/auth-claude'
import type { AuthChild, SpawnFn } from '../src/auth-codex'

describe('parseClaudeSetupOutput', () => {
  it('extracts the sign-in URL', () => {
    expect(parseClaudeSetupOutput('Visit https://claude.ai/oauth/authorize?x=1 to continue')).toEqual({
      verifyUrl: 'https://claude.ai/oauth/authorize?x=1',
    })
  })
  it('returns null before a URL appears', () => {
    expect(parseClaudeSetupOutput('Starting…')).toBeNull()
  })
})

describe('parseClaudeStatus', () => {
  it('maps loggedIn JSON to connected', () => {
    expect(parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai"}')).toBe('connected')
  })
  it('maps logged-out JSON to disconnected', () => {
    expect(parseClaudeStatus('{"loggedIn":false}')).toBe('disconnected')
  })
})

function fakeChild(): AuthChild & { emitOut(s: string): void; emitExit(code: number): void; written: string } {
  const ee = new EventEmitter() as AuthChild & { emitOut(s: string): void; emitExit(code: number): void; written: string }
  ee.written = ''
  Object.defineProperty(ee, 'stdout', { value: new EventEmitter(), configurable: true })
  Object.defineProperty(ee, 'stderr', { value: new EventEmitter(), configurable: true })
  Object.defineProperty(ee, 'stdin', { value: { write: (s: string) => (ee.written += s), end: () => {} }, configurable: true })
  ee.kill = () => true
  ee.emitOut = (s) => (ee.stdout as EventEmitter).emit('data', Buffer.from(s))
  ee.emitExit = (code) => ee.emit('exit', code)
  return ee
}

describe('ClaudeAuthenticator', () => {
  it('begin() resolves device mode with needsCode once the URL prints', async () => {
    const child = fakeChild()
    const auth = new ClaudeAuthenticator(() => child, () => null)
    const p = auth.begin()
    child.emitOut('Open https://claude.ai/oauth/authorize?x=1 and paste the code below')
    await expect(p).resolves.toEqual({ mode: 'device', verifyUrl: 'https://claude.ai/oauth/authorize?x=1', userCode: null, needsCode: true })
  })

  it('submitCode() writes the code to stdin and maps exit 0 to connected', async () => {
    const child = fakeChild()
    const auth = new ClaudeAuthenticator(() => child, () => null)
    const p = auth.begin()
    child.emitOut('Open https://claude.ai/x and paste the code')
    await p
    const sp = auth.submitCode('ABC-123')
    child.emitExit(0)
    expect(await sp).toBe('connected')
    expect(child.written).toContain('ABC-123')
  })

  it('status() surfaces expired when the credential file is past expiry', async () => {
    // status spawns `claude auth status`; return loggedIn JSON, then check creds.
    const statusChild = fakeChild()
    const spawnFn: SpawnFn = () => statusChild
    const auth = new ClaudeAuthenticator(spawnFn, () => ({ expiresAt: Date.now() - 1000 }))
    const p = auth.status()
    statusChild.emitOut('{"loggedIn":true,"authMethod":"claude.ai"}')
    statusChild.emitExit(0)
    expect(await p).toBe('expired')
  })
})
