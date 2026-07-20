import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountKind } from '@trux/protocol'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'

// Pi has no `pi login` CLI subcommand — login happens inside the Pi console
// (the `/login` slash command), which writes OAuth tokens to
// ~/.pi/agent/auth.json. Env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, …) are
// an alternative credential source. There is no login flow for Trux to relay
// to mobile: the user sets up Pi credentials on the desktop (via the Pi
// console or env), and mobile reuses them through the backend's Pi adapter,
// which runs `pi --mode json` locally. This authenticator is status-detection
// only — if Pi isn't authenticated, the user must set up credentials on the box.

export interface PiAuthFile {
  [provider: string]: {
    type: 'oauth' | 'api_key' | string
    access?: string
    key?: string
    expires?: number
  } | undefined
}

export interface PiFsSeam {
  read(): PiAuthFile
}

const defaultPath = (): string => join(homedir(), '.pi', 'agent', 'auth.json')

const defaultFs: PiFsSeam = {
  read: () => {
    try {
      // Object.create(null) prevents prototype pollution: a JSON key like
      // '__proto__' can't shadow Object.prototype because the parsed object
      // has no prototype chain. The cast is safe because PiAuthFile is a
      // plain record type.
      const parsed = JSON.parse(readFileSync(defaultPath(), 'utf8')) as Record<string, unknown>
      const safe: PiAuthFile = Object.create(null)
      for (const [k, v] of Object.entries(parsed)) safe[k] = v as PiAuthFile[string]
      return safe
    } catch {
      return Object.create(null) as PiAuthFile
    }
  },
}

// Environment variables Pi recognizes (from `pi --help`). If any is set, Pi
// can run with that provider's credentials — report connected.
const PI_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'GROQ_API_KEY',
  'CEREBRAS_API_KEY',
  'XAI_API_KEY',
  'FIREWORKS_API_KEY',
  'TOGETHER_API_KEY',
  'OPENROUTER_API_KEY',
  'AI_GATEWAY_API_KEY',
  'MISTRAL_API_KEY',
  'OPENCODE_API_KEY',
]

function hasEnvCredentials(env: Record<string, string | undefined>): boolean {
  return PI_ENV_VARS.some((k) => {
    const v = env[k]
    return typeof v === 'string' && v.length > 0
  })
}

// Determine connection status from the auth file + env vars. An OAuth entry
// is connected if its `expires` is in the future; an api_key entry is
// connected if it has a non-empty key. Env vars are connected if present.
export function piStatusFromAuthFile(file: PiAuthFile, env: Record<string, string | undefined>): AuthStatus {
  for (const entry of Object.values(file)) {
    if (!entry) continue
    if (entry.type === 'oauth') {
      if (entry.access) {
        if (entry.expires && entry.expires < Date.now()) continue // expired
        return 'connected'
      }
    }
    if (entry.type === 'api_key') {
      if (entry.key && entry.key.length > 0) return 'connected'
    }
  }
  if (hasEnvCredentials(env)) return 'connected'
  return 'disconnected'
}

export class PiAuthenticator implements Authenticator {
  readonly id = 'pi'
  readonly plane = 'model' as const
  // 'native' = Pi's own credential store at ~/.pi/agent/auth.json, set up via
  // the Pi console's /login command. Env vars are a secondary path. Either
  // way, Trux doesn't own or relay the login.
  readonly accountKind: AccountKind = 'native'

  constructor(
    private readonly fs: PiFsSeam = defaultFs,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  // No login flow — Pi uses env vars or a pre-configured auth file. Surface
  // an apikey-mode label explaining that credentials must be set on the box.
  begin(): Promise<AuthMode> {
    return Promise.resolve({
      mode: 'apikey',
      label: 'Set credentials on the box (env vars or ~/.pi/agent/auth.json)',
    })
  }

  // No polling — no in-flight login.
  poll(): Promise<AuthStatus> {
    return this.status()
  }

  status(): Promise<AuthStatus> {
    return Promise.resolve(piStatusFromAuthFile(this.fs.read(), this.env))
  }

  // No disconnect — Trux doesn't own Pi's credential store.
  disconnect(): Promise<void> {
    return Promise.resolve()
  }
}
