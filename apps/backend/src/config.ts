import { homedir } from 'node:os'
import { join } from 'node:path'

// 12-factor config: bind host/port, db path, secret, auth toggle — all from env.
// Local default binds loopback with auth optional (see design: Deployment & operations).
export interface Config {
  host: string
  port: number
  dbPath: string
  secret: string | null
  authRequired: boolean
}

function bool(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.TRUX_HOST ?? '127.0.0.1',
    port: env.TRUX_PORT ? Number(env.TRUX_PORT) : 4317,
    dbPath: env.TRUX_DB_PATH ?? join(homedir(), '.trux', 'trux.db'),
    secret: env.TRUX_SECRET ?? null,
    authRequired: bool(env.TRUX_AUTH),
  }
}
