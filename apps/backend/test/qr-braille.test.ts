import { describe, expect, it } from 'vitest'
import { renderBrailleQr } from '../src/qr-braille'

describe('renderBrailleQr', () => {
  it('renders a short pair URL in roughly half the old QR height', () => {
    const url = 'https://pc.tail7169ea.ts.net/p/ABCD1234'
    const out = renderBrailleQr(url)
    const lines = out.trimEnd().split('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThanOrEqual(12)
    expect(lines[0]!.length).toBeGreaterThan(0)
    // Braille block characters
    expect(out).toMatch(/[\u2800-\u28FF]/)
  })

  it('produces a non-empty QR for a full token fragment URL too', () => {
    const url = 'https://pc.tail7169ea.ts.net/#token=' + 'a'.repeat(64)
    const lines = renderBrailleQr(url).trimEnd().split('\n')
    expect(lines.length).toBeGreaterThan(0)
  })
})
