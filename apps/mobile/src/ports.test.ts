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
  it('carries dark sumi ink + celadon accent', () => {
    expect(theme.accent).toBe('#8fbc8f')
    expect(theme.accentBright).toBe('#a8cfa8')
    expect(theme.ink).toBe('#0b0c0b')
    expect(theme.radius).toBe(8)
    expect(theme.fontSans).toBe('IBM Plex Sans')
    expect(theme.fontMono).toBe('IBM Plex Mono')
  })
})
