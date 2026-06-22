import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureClient } from '../src/ports'
import { authApi } from '../src/auth'

beforeEach(() => {
  configureClient({
    storage: { get: (k) => (k === 'trux_token' ? 'secret123' : null), set: () => {}, remove: () => {} },
    serverConfig: { httpBase: 'https://box.ts.net', wsBase: 'wss://box.ts.net' },
  })
})

describe('authApi', () => {
  it('begin POSTs to the provider with the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ mode: 'device', verifyUrl: 'https://x', userCode: 'A-1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await authApi.begin('codex')
    expect(fetchMock).toHaveBeenCalledWith('https://box.ts.net/auth/codex/begin', {
      method: 'POST',
      headers: { authorization: 'Bearer secret123' },
    })
    expect(res).toEqual({ mode: 'device', verifyUrl: 'https://x', userCode: 'A-1' })
  })
})
