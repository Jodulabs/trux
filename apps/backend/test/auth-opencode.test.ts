import { EventEmitter } from 'node:events'
import { describe, it, expect } from 'vitest'
import { OpencodeAuthenticator, type FsSeam } from '../src/auth-opencode'
import type { AuthChild, SpawnFn } from '../src/auth-codex'
import { parseOpencodeLoginOutput } from '../src/auth-provider'

function memFs(initial: Record<string, unknown> = {}): FsSeam & { data: Record<string, unknown> } {
  const store: { data: Record<string, unknown> } = { data: { ...initial } }
  return {
    data: store.data,
    read: () => store.data as never,
    write: (d) => { store.data = d as never; (store as { data: Record<string, unknown> }).data = d as never },
  } as FsSeam & { data: Record<string, unknown> }
}

// A fake child that emits scripted stdout chunks then exits.
class FakeChild extends EventEmitter implements AuthChild {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = { write: (_s: string): void => {}, end: (): void => {} }
  killed = false
  kill(): boolean { this.killed = true; return true }

  feed(chunk: string): void { this.stdout.emit('data', Buffer.from(chunk)) }
  exit(code = 0): void { this.emit('exit', code) }
}

describe('parseOpencodeLoginOutput', () => {
  it('scrapes the verify URL and one-time code from the TUI output', () => {
    // Real output (ANSI-escaped, with TUI box-drawing chars) from the spike:
    const raw = '\x1b[0m\n┌  Add credential\n│\n●  Go to: https://auth.openai.com/codex/device\n│\n●  Enter code: GV2N-IXK77\n'
    expect(parseOpencodeLoginOutput(raw)).toEqual({
      verifyUrl: 'https://auth.openai.com/codex/device',
      userCode: 'GV2N-IXK77',
    })
  })

  it('returns null before the URL has appeared', () => {
    expect(parseOpencodeLoginOutput('waiting…')).toBeNull()
  })

  it('returns the URL with userCode null when no dash-joined code is present', () => {
    expect(parseOpencodeLoginOutput('Go to: https://x.example/auth\nno code here')).toEqual({
      verifyUrl: 'https://x.example/auth',
      userCode: null,
    })
  })

  it('strips trailing punctuation from the URL', () => {
    const parsed = parseOpencodeLoginOutput('Go to: https://x.example/auth.')
    expect(parsed?.verifyUrl).toBe('https://x.example/auth')
  })
})

describe('OpencodeAuthenticator', () => {
  it('accountKind is subscription (device flow is the primary path)', () => {
    const auth = new OpencodeAuthenticator(memFs())
    expect(auth.accountKind).toBe('subscription')
  })

  it('begin() runs the headless ChatGPT login and returns device mode with URL + code', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = (_cmd, _args) => child
    const auth = new OpencodeAuthenticator(memFs(), spawnFn)

    const pending = auth.begin()
    // Feed the scripted TUI output (URL + code appear together).
    child.feed('\x1b[0m\n┌  Add credential\n│\n●  Go to: https://auth.openai.com/codex/device\n│\n●  Enter code: GV2N-IXK77\n')
    const mode = await pending
    expect(mode).toEqual({
      mode: 'device',
      verifyUrl: 'https://auth.openai.com/codex/device',
      userCode: 'GV2N-IXK77',
    })
  })

  it('begin() rejects if the child exits before printing a URL', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = (_cmd, _args) => child
    const auth = new OpencodeAuthenticator(memFs(), spawnFn)

    const pending = auth.begin()
    child.exit(1)
    await expect(pending).rejects.toThrow(/exited before printing/)
  })

  it('poll reports pending while the login child is in flight', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = (_cmd, _args) => child
    const auth = new OpencodeAuthenticator(memFs(), spawnFn)

    const pending = auth.begin()
    child.feed('●  Go to: https://auth.openai.com/codex/device\n●  Enter code: GV2N-IXK77\n')
    await pending // resolves once URL appears, but the child is still running
    expect(await auth.poll()).toBe('pending')
    child.exit(0)
  })

  it('poll reports connected after the login child exits 0', async () => {
    const child = new FakeChild()
    const spawnFn: SpawnFn = (_cmd, _args) => child
    const auth = new OpencodeAuthenticator(memFs(), spawnFn)

    const pending = auth.begin()
    child.feed('●  Go to: https://auth.openai.com/codex/device\n●  Enter code: GV2N-IXK77\n')
    await pending
    child.exit(0)
    expect(await auth.poll()).toBe('connected')
  })

  it('status reports connected when an oauth entry has a non-expired access token', async () => {
    const fs = memFs({ openai: { type: 'oauth', access: 'tok', expires: Date.now() + 10_000 } })
    const auth = new OpencodeAuthenticator(fs)
    expect(await auth.status()).toBe('connected')
  })

  it('status reports disconnected when an oauth entry is expired', async () => {
    const fs = memFs({ openai: { type: 'oauth', access: 'tok', expires: Date.now() - 10_000 } })
    const auth = new OpencodeAuthenticator(fs)
    expect(await auth.status()).toBe('disconnected')
  })

  it('submitKey writes the opencode-go entry and status reports connected', async () => {
    const fs = memFs()
    const auth = new OpencodeAuthenticator(fs)
    expect(await auth.status()).toBe('disconnected')
    expect(await auth.submitKey('sk-oc-123')).toBe('connected')
    expect((fs.read() as Record<string, { type: string; key: string }>)['opencode-go']).toEqual({ type: 'api', key: 'sk-oc-123' })
    expect(await auth.status()).toBe('connected')
  })

  it('disconnect removes the opencode-go entry but preserves other providers', async () => {
    const fs = memFs({ openai: { type: 'oauth' }, 'opencode-go': { type: 'api', key: 'x' } })
    // Use a spawn that always exits 0 so the CLI logout call resolves.
    const spawnFn: SpawnFn = () => {
      const c = new FakeChild()
      // The disconnect path awaits exit; emit it on next tick.
      queueMicrotask(() => c.exit(0))
      return c
    }
    const auth = new OpencodeAuthenticator(fs, spawnFn)
    await auth.disconnect()
    expect((fs.read() as Record<string, unknown>)['opencode-go']).toBeUndefined()
    expect((fs.read() as Record<string, unknown>)['openai']).toEqual({ type: 'oauth' })
  })
})
