import { describe, it, expect } from 'vitest'
import { OpencodeAuthenticator, type FsSeam } from '../src/auth-opencode'

function memFs(initial: Record<string, unknown> = {}): FsSeam & { data: Record<string, unknown> } {
  const store: { data: Record<string, unknown> } = { data: { ...initial } }
  return {
    data: store.data,
    read: () => store.data as never,
    write: (d) => { store.data = d as never; (store as { data: Record<string, unknown> }).data = d as never },
  } as FsSeam & { data: Record<string, unknown> }
}

describe('OpencodeAuthenticator', () => {
  it('begin() returns apikey mode', async () => {
    const auth = new OpencodeAuthenticator(memFs())
    expect(await auth.begin()).toEqual({ mode: 'apikey', label: 'opencode-go API key' })
  })
  it('submitKey writes the opencode-go entry and status reports connected', async () => {
    const fs = memFs()
    const auth = new OpencodeAuthenticator(fs)
    expect(await auth.status()).toBe('disconnected')
    expect(await auth.submitKey('sk-oc-123')).toBe('connected')
    expect((fs.read() as Record<string, { type: string; key: string }>)['opencode-go']).toEqual({ type: 'api', key: 'sk-oc-123' })
    expect(await auth.status()).toBe('connected')
  })
  it('disconnect removes the entry but preserves other providers', async () => {
    const fs = memFs({ openai: { type: 'oauth' }, 'opencode-go': { type: 'api', key: 'x' } })
    const auth = new OpencodeAuthenticator(fs)
    await auth.disconnect()
    expect((fs.read() as Record<string, unknown>)['opencode-go']).toBeUndefined()
    expect((fs.read() as Record<string, unknown>)['openai']).toEqual({ type: 'oauth' })
  })
})
