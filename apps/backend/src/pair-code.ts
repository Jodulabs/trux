import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const PAIR_TTL_MS = 10 * 60 * 1000

// Crockford base32 (no I,L,O,U) — readable on phone screens.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export interface PairCodeRecord {
  code: string
  expiresAt: number
}

export function pairCodePath(home: string = homedir()): string {
  return join(home, '.trux', 'pair-code')
}

export function generatePairCode(bytes: Buffer = randomBytes(5)): string {
  // 5 bytes → 8 crockford chars
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out = ALPHABET[Number(n & 31n)] + out
    n >>= 5n
  }
  return out
}

export function writePairCode(
  opts: { home?: string; now?: number; ttlMs?: number; code?: string } = {},
): PairCodeRecord {
  const home = opts.home ?? homedir()
  const now = opts.now ?? Date.now()
  const ttlMs = opts.ttlMs ?? PAIR_TTL_MS
  const record: PairCodeRecord = {
    code: opts.code ?? generatePairCode(),
    expiresAt: now + ttlMs,
  }
  const path = pairCodePath(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(record) + '\n', { mode: 0o600 })
  return record
}

export function readPairCode(home: string = homedir()): PairCodeRecord | null {
  const path = pairCodePath(home)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<PairCodeRecord>
    if (typeof raw.code !== 'string' || typeof raw.expiresAt !== 'number') return null
    return { code: raw.code, expiresAt: raw.expiresAt }
  } catch {
    return null
  }
}

/** Returns the record when code matches and is unexpired; otherwise null. */
export function validatePairCode(
  code: string,
  opts: { home?: string; now?: number } = {},
): PairCodeRecord | null {
  const record = readPairCode(opts.home ?? homedir())
  if (!record) return null
  const now = opts.now ?? Date.now()
  if (now > record.expiresAt) return null
  if (record.code.toUpperCase() !== code.toUpperCase()) return null
  return record
}

export function pairUrl(publicHost: string, code: string): string {
  return `https://${publicHost}/p/${code}`
}
