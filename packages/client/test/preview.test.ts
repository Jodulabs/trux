import { describe, it, expect, beforeEach } from 'vitest'
import { configureClient } from '../src/ports'
import { previewUrl } from '../src/preview'

function configure(serverConfig: { httpBase: string; wsBase: string }, token: string | null): void {
  const store = new Map<string, string>()
  if (token !== null) store.set('trux_token', token)
  configureClient({
    storage: { get: (k) => store.get(k) ?? null, set: () => {}, remove: () => {} },
    serverConfig,
  })
}

describe('previewUrl', () => {
  beforeEach(() => {
    configure({ httpBase: 'http://box:4317', wsBase: 'ws://box:4317' }, 'sekret')
  })

  it('builds a tokenized path-prefix url from httpBase', () => {
    expect(previewUrl(3000)).toBe('http://box:4317/__preview__/3000/?__trux_token=sekret')
  })

  it('derives http base from wsBase when httpBase is empty', () => {
    configure({ httpBase: '', wsBase: 'wss://box.ts.net' }, 'sekret')
    expect(previewUrl(5173)).toBe('https://box.ts.net/__preview__/5173/?__trux_token=sekret')
  })

  it('yields a root-relative url when both bases are empty (web same-origin)', () => {
    configure({ httpBase: '', wsBase: '' }, 'sekret')
    expect(previewUrl(8080)).toBe('/__preview__/8080/?__trux_token=sekret')
  })

  it('url-encodes the token and tolerates a missing token', () => {
    configure({ httpBase: 'http://box', wsBase: 'ws://box' }, null)
    expect(previewUrl(3000)).toBe('http://box/__preview__/3000/?__trux_token=')
  })
})
