import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generatePairCode,
  writePairCode,
  readPairCode,
  validatePairCode,
  pairUrl,
  PAIR_TTL_MS,
} from '../src/pair-code'

describe('pair-code', () => {
  it('generates 8 crockford chars', () => {
    const code = generatePairCode(Buffer.from([0, 0, 0, 0, 1]))
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/)
  })

  it('writes, reads, and validates a live code', () => {
    const home = mkdtempSync(join(tmpdir(), 'trux-pair-'))
    try {
      const now = 1_000_000
      const record = writePairCode({ home, now, code: 'ABCD1234' })
      expect(record.expiresAt).toBe(now + PAIR_TTL_MS)
      expect(readPairCode(home)).toEqual(record)
      expect(validatePairCode('ABCD1234', { home, now: now + 1000 })).toEqual(record)
      expect(validatePairCode('abcd1234', { home, now })).toEqual(record) // case-insensitive
      expect(validatePairCode('WRONGXXX', { home, now })).toBeNull()
      expect(validatePairCode('ABCD1234', { home, now: record.expiresAt + 1 })).toBeNull()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('replaces the previous code on write', () => {
    const home = mkdtempSync(join(tmpdir(), 'trux-pair-'))
    try {
      writePairCode({ home, code: 'FIRST111' })
      writePairCode({ home, code: 'SECOND22' })
      expect(readPairCode(home)?.code).toBe('SECOND22')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('builds the short pair URL', () => {
    expect(pairUrl('pc.tail123.ts.net', 'ABCD1234')).toBe('https://pc.tail123.ts.net/p/ABCD1234')
  })
})
