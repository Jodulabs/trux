import { parsePairQr } from '../src/ports'
import { theme } from '../src/theme'

describe('parsePairQr', () => {
  it('extracts host + token from a tailscale pairing URL', () => {
    const r = parsePairQr('https://box.tail123.ts.net/#token=abc123')
    expect(r).toEqual({ host: 'box.tail123.ts.net', token: 'abc123' })
  })

  it('URL-decodes the token', () => {
    const r = parsePairQr('https://box.ts.net/#token=a%2Bb%2Fc')
    expect(r?.token).toBe('a+b/c')
  })

  it('returns null when there is no token fragment', () => {
    expect(parsePairQr('https://box.ts.net/')).toBeNull()
  })

  it('returns null for a non-URL payload', () => {
    expect(parsePairQr('not a url')).toBeNull()
  })
})

describe('theme', () => {
  it('carries the copper accent + ink surface from the PWA', () => {
    expect(theme.accent).toBe('#e8843d')
    expect(theme.ink).toBe('#0c0d10')
    expect(theme.fontSans).toBe('IBM Plex Sans')
    expect(theme.fontMono).toBe('IBM Plex Mono')
  })
})
