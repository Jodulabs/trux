import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { AccountKind } from '@trux/protocol'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'
import { parseOpencodeLoginOutput, stripAnsi } from './auth-provider'
import { type AuthChild, type SpawnFn } from './auth-codex'

// opencode-go is opencode's own (API-key) provider — the ToS-safe subscription
// path for opencode is a key in opencode's own auth store. Default path from the
// spike: ~/.local/share/opencode/auth.json.
const OPENCODE_GO = 'opencode-go'
type AuthFile = Record<string, { type: string; key?: string; access?: string; expires?: number } | undefined>

export interface FsSeam {
  read(): AuthFile
  write(data: AuthFile): void
}
const defaultPath = (): string => join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const defaultFs: FsSeam = {
  read: () => {
    try {
      // Object.create(null) prevents prototype pollution: a JSON key like
      // '__proto__' can't shadow Object.prototype because the parsed object
      // has no prototype chain.
      const parsed = JSON.parse(readFileSync(defaultPath(), 'utf8')) as Record<string, unknown>
      const safe: AuthFile = Object.create(null)
      for (const [k, v] of Object.entries(parsed)) safe[k] = v as AuthFile[string]
      return safe
    } catch {
      return Object.create(null) as AuthFile
    }
  },
  write: (data) => {
    const p = defaultPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 })
  },
}

const defaultSpawn: SpawnFn = (cmd, args) => spawn(cmd, args) as unknown as AuthChild

// opencode has two login paths:
// 1. Device flow (subscription): `opencode providers login --provider openai
//    --method "ChatGPT Pro/Plus (headless)"` prints a URL + code, then polls.
// 2. API key (fallback): write directly to auth.json (the old path).
export class OpencodeAuthenticator implements Authenticator {
  readonly id = 'opencode'
  readonly plane = 'model' as const
  readonly accountKind: AccountKind = 'subscription'

  // The in-flight device-login child + the status it has reached.
  private child: AuthChild | null = null
  private deviceStatus: AuthStatus = 'disconnected'

  constructor(
    private readonly fs: FsSeam = defaultFs,
    private readonly spawnFn: SpawnFn = defaultSpawn,
  ) {}

  // Device flow: run the headless ChatGPT login and scrape the URL + code.
  // This is the primary path — opencode's ChatGPT subscription via OAuth.
  begin(): Promise<AuthMode> {
    this.child?.kill()
    const child = this.spawnFn('opencode', [
      'providers', 'login',
      '--provider', 'openai',
      '--method', 'ChatGPT Pro/Plus (headless)',
    ])
    this.child = child
    this.deviceStatus = 'pending'
    let buf = ''
    return new Promise<AuthMode>((resolve, reject) => {
      let settled = false
      const onData = (d: Buffer): void => {
        buf += d.toString()
        const parsed = parseOpencodeLoginOutput(buf)
        if (parsed && !settled) {
          settled = true
          resolve({ mode: 'device', verifyUrl: parsed.verifyUrl, userCode: parsed.userCode })
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('exit', (code: number) => {
        this.deviceStatus = code === 0 ? 'connected' : 'disconnected'
        this.child = null
        if (!settled) {
          settled = true
          reject(new Error('opencode providers login exited before printing a verification URL'))
        }
      })
    })
  }

  // The held child reports progress: pending while it runs, connected/disconnected
  // once it exits. Falls back to persisted status when no login is in flight.
  async poll(): Promise<AuthStatus> {
    if (this.child) return 'pending'
    return this.deviceStatus === 'connected' ? 'connected' : this.status()
  }

  // Connected if any oauth entry with a non-expired access token, or the
  // opencode-go API key entry exists.
  status(): Promise<AuthStatus> {
    const data = this.fs.read()
    for (const entry of Object.values(data)) {
      if (!entry) continue
      if (entry.type === 'oauth' && entry.access) {
        if (entry.expires && entry.expires < Date.now()) continue
        return Promise.resolve('connected')
      }
    }
    const go = data[OPENCODE_GO]
    return Promise.resolve(go && go.key ? 'connected' : 'disconnected')
  }

  // API key fallback: write directly to auth.json (preserves unrelated entries).
  // The route layer enforces max length; this trim + cap is defense in depth.
  submitKey(key: string): Promise<AuthStatus> {
    const trimmed = key.trim()
    if (trimmed.length === 0 || trimmed.length > 8 * 1024) {
      return Promise.resolve('disconnected')
    }
    const data = this.fs.read()
    data[OPENCODE_GO] = { type: 'api', key: trimmed }
    this.fs.write(data)
    return Promise.resolve('connected')
  }

  async disconnect(): Promise<void> {
    this.child?.kill()
    this.child = null
    this.deviceStatus = 'disconnected'
    // Try the CLI logout for the openai provider; fall back to file edit.
    await this.run(['providers', 'logout', 'openai']).catch(() => undefined)
    // Also remove the opencode-go entry from the file if the CLI didn't cover it.
    const data = this.fs.read()
    if (data[OPENCODE_GO]) {
      delete data[OPENCODE_GO]
      this.fs.write(data)
    }
  }

  private run(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnFn('opencode', args)
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('exit', (code: number) => (code === 0 ? resolve(out) : reject(new Error(`opencode ${args.join(' ')} exited ${code}`))))
    })
  }
}

// Unused export suppression — stripAnsi is re-exported for tests that want to
// test the parser with raw ANSI input.
export { stripAnsi }
