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
  workspaceRoots: string[]
  tailscaleHost: string | null
  // Public hostname the phone reaches trux at, for pairing URLs/QR. Backend-agnostic:
  // local sets it from Tailscale, the Fly driver sets it to <app>.fly.dev. Optional so
  // existing Config literals (tests, server) keep compiling.
  publicHost?: string | null
  // When true, push bodies are genericized ("Approval required") so a lockscreen
  // preview can't leak a command or path.
  pushPrivacy: boolean
}

// Only an explicit '1'/'true' is true. Note this is fail-OPEN for TRUX_AUTH: a typo or unset
// value yields authRequired=false (auth off) — fine locally, but remote deploy must verify it's on.
function bool(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

// Fail fast if auth is required but no secret is configured — silent accept-all
// would be a security hole on a public Tailscale node.
export function assertConfig(config: Config): void {
  if (config.authRequired && !config.secret) {
    throw new Error('TRUX_AUTH=1 requires TRUX_SECRET to be set')
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.TRUX_HOST ?? '127.0.0.1',
    port: env.TRUX_PORT ? Number(env.TRUX_PORT) : 4317,
    dbPath: env.TRUX_DB_PATH ?? join(homedir(), '.trux', 'trux.db'),
    secret: env.TRUX_SECRET ?? null,
    authRequired: bool(env.TRUX_AUTH),
    workspaceRoots: env.TRUX_WORKSPACES ? env.TRUX_WORKSPACES.split(':').filter(Boolean) : [],
    tailscaleHost: env.TRUX_TAILSCALE_HOST ?? null,
    publicHost: env.TRUX_PUBLIC_HOST ?? env.TRUX_TAILSCALE_HOST ?? null,
    pushPrivacy: bool(env.TRUX_PUSH_PRIVACY),
  }
}
