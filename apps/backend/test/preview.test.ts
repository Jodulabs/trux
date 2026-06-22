import { describe, it, expect } from 'vitest'
import {
  parsePreviewPath,
  injectBaseTag,
  previewAuthDecision,
  readPreviewCookie,
  stripTokenFromUrl,
} from '../src/preview'
import type { Config } from '../src/config'

const authOn = { authRequired: true, secret: 'sekret' } as unknown as Config
const authOff = { authRequired: false, secret: null } as unknown as Config

describe('parsePreviewPath', () => {
  it('parses a full path with query', () => {
    expect(parsePreviewPath('/__preview__/3000/foo?x=1')).toEqual({ port: 3000, rest: '/foo?x=1' })
  })

  it('parses the bare form to rest "/"', () => {
    expect(parsePreviewPath('/__preview__/3000')).toEqual({ port: 3000, rest: '/' })
  })

  it('parses the bare form with a trailing slash', () => {
    expect(parsePreviewPath('/__preview__/3000/')).toEqual({ port: 3000, rest: '/' })
  })

  it('keeps a query on the bare form', () => {
    expect(parsePreviewPath('/__preview__/3000?x=1')).toEqual({ port: 3000, rest: '/?x=1' })
  })

  it('rejects a non-preview url', () => {
    expect(parsePreviewPath('/conversations/abc')).toBeNull()
  })

  it('rejects a non-numeric port', () => {
    expect(parsePreviewPath('/__preview__/abc/foo')).toBeNull()
  })

  it('rejects an out-of-range port', () => {
    expect(parsePreviewPath('/__preview__/99999/')).toBeNull()
    expect(parsePreviewPath('/__preview__/0/')).toBeNull()
  })

  it('accepts boundary ports', () => {
    expect(parsePreviewPath('/__preview__/1')).toEqual({ port: 1, rest: '/' })
    expect(parsePreviewPath('/__preview__/65535')).toEqual({ port: 65535, rest: '/' })
  })
})

describe('injectBaseTag', () => {
  it('inserts right after <head>', () => {
    const out = injectBaseTag('<html><head><title>x</title></head></html>', 3000)
    expect(out).toBe('<html><head><base href="/__preview__/3000/"><title>x</title></head></html>')
  })

  it('inserts after <head ...> with attributes (case-insensitive)', () => {
    const out = injectBaseTag('<HEAD data-x>hi</HEAD>', 8080)
    expect(out).toContain('<HEAD data-x><base href="/__preview__/8080/">hi')
  })

  it('falls back to after <html> when there is no head', () => {
    const out = injectBaseTag('<html lang="en"><body>x</body></html>', 5173)
    expect(out).toBe('<html lang="en"><base href="/__preview__/5173/"><body>x</body></html>')
  })

  it('prepends when neither head nor html present', () => {
    const out = injectBaseTag('<div>x</div>', 3000)
    expect(out).toBe('<base href="/__preview__/3000/"><div>x</div>')
  })
})

describe('readPreviewCookie', () => {
  it('extracts the trux_preview value', () => {
    expect(readPreviewCookie('a=1; trux_preview=tok; b=2')).toBe('tok')
  })
  it('returns null when absent or undefined', () => {
    expect(readPreviewCookie('a=1')).toBeNull()
    expect(readPreviewCookie(undefined)).toBeNull()
  })
})

describe('stripTokenFromUrl', () => {
  it('removes __trux_token, keeps other params', () => {
    expect(stripTokenFromUrl('/__preview__/3000/?__trux_token=t&x=1')).toBe('/__preview__/3000/?x=1')
  })
  it('drops the query entirely when token was the only param', () => {
    expect(stripTokenFromUrl('/__preview__/3000/?__trux_token=t')).toBe('/__preview__/3000/')
  })
  it('leaves a query-less url untouched', () => {
    expect(stripTokenFromUrl('/__preview__/3000/foo')).toBe('/__preview__/3000/foo')
  })
})

describe('previewAuthDecision', () => {
  it('rejects with no token/cookie when auth is required', () => {
    expect(previewAuthDecision({ cookie: null, queryToken: null, config: authOn })).toEqual({ action: 'reject' })
  })

  it('sets a cookie + redirects on a valid query token', () => {
    expect(previewAuthDecision({ cookie: null, queryToken: 'sekret', config: authOn })).toEqual({
      action: 'setCookieRedirect',
      token: 'sekret',
    })
  })

  it('rejects an invalid query token', () => {
    expect(previewAuthDecision({ cookie: null, queryToken: 'wrong', config: authOn })).toEqual({ action: 'reject' })
  })

  it('passes on a valid cookie', () => {
    expect(previewAuthDecision({ cookie: 'sekret', queryToken: null, config: authOn })).toEqual({ action: 'pass' })
  })

  it('passes with nothing when auth is off (local dev)', () => {
    expect(previewAuthDecision({ cookie: null, queryToken: null, config: authOff })).toEqual({ action: 'pass' })
  })
})
