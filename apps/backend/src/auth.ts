import { timingSafeEqual } from 'node:crypto'
import type { Config } from './config'

// Constant-time secret compare — the auth boundary is the RCE boundary.
export function tokenMatches(secret: string, token: string): boolean {
  const a = Buffer.from(secret)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

// True when a presented token is acceptable under the current config.
export function tokenAccepted(config: Config, token: string | null): boolean {
  if (!config.authRequired) return true
  return config.secret !== null && token !== null && tokenMatches(config.secret, token)
}
