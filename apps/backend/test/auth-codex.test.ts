import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { parseCodexDeviceOutput, parseCodexStatus } from '../src/auth-provider'
import { CodexAuthenticator, type AuthChild, type SpawnFn } from '../src/auth-codex'

describe('parseCodexDeviceOutput', () => {
  it('extracts the verify URL and user code', () => {
    const out = 'To authenticate, visit https://chatgpt.com/device and enter code: WXYZ-1234\n'
    expect(parseCodexDeviceOutput(out)).toEqual({ verifyUrl: 'https://chatgpt.com/device', userCode: 'WXYZ-1234' })
  })
  it('returns the URL with a null code when no code is present', () => {
    expect(parseCodexDeviceOutput('Open https://example.com/auth to continue')).toEqual({
      verifyUrl: 'https://example.com/auth',
      userCode: null,
    })
  })
  it('returns null before any URL appears', () => {
    expect(parseCodexDeviceOutput('Starting device authorization…')).toBeNull()
  })
})

describe('parseCodexStatus', () => {
  it('maps a logged-in line to connected', () => {
    expect(parseCodexStatus('Logged in using ChatGPT')).toBe('connected')
  })
  it('maps a not-logged-in line to disconnected', () => {
    expect(parseCodexStatus('Not logged in')).toBe('disconnected')
  })
})

function fakeChild(): AuthChild & { emitOut(s: string): void; emitExit(code: number): void } {
  const ee = new EventEmitter() as AuthChild & { emitOut(s: string): void; emitExit(code: number): void }
  Object.defineProperty(ee, 'stdout', { value: new EventEmitter(), configurable: true })
  Object.defineProperty(ee, 'stderr', { value: new EventEmitter(), configurable: true })
  Object.defineProperty(ee, 'stdin', { value: { write: () => {}, end: () => {} }, configurable: true })
  ee.kill = () => true
  ee.emitOut = (s) => (ee.stdout as EventEmitter).emit('data', Buffer.from(s))
  ee.emitExit = (code) => ee.emit('exit', code)
  return ee
}

describe('CodexAuthenticator', () => {
  it('begin() resolves with the device URL+code once stdout prints them', async () => {
    const child = fakeChild()
    const spawnFn: SpawnFn = () => child
    const auth = new CodexAuthenticator(spawnFn)
    const p = auth.begin()
    child.emitOut('Visit https://chatgpt.com/device and enter code: ABCD-7788')
    await expect(p).resolves.toEqual({ mode: 'device', verifyUrl: 'https://chatgpt.com/device', userCode: 'ABCD-7788' })
  })

  it('poll() is pending while the child runs, connected after exit 0', async () => {
    const child = fakeChild()
    const auth = new CodexAuthenticator(() => child)
    const p = auth.begin()
    child.emitOut('Visit https://chatgpt.com/device code: ABCD-7788')
    await p
    expect(await auth.poll()).toBe('pending')
    child.emitExit(0)
    expect(await auth.poll()).toBe('connected')
  })

  it('submitKey() pipes the key and maps exit 0 to connected', async () => {
    let written = ''
    const child = fakeChild()
    Object.defineProperty(child, 'stdin', { value: { write: (s: string) => (written = s), end: () => {} } })
    const auth = new CodexAuthenticator(() => child)
    const p = auth.submitKey('sk-test-123')
    child.emitExit(0)
    expect(await p).toBe('connected')
    expect(written).toContain('sk-test-123')
  })
})
