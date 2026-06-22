import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'

// opencode-go is opencode's own (API-key) provider — the ToS-safe subscription
// path for opencode is a key in opencode's own auth store. Default path from the
// spike: ~/.local/share/opencode/auth.json.
const OPENCODE_GO = 'opencode-go'
type AuthFile = Record<string, { type: string; key?: string } | undefined>

export interface FsSeam {
  read(): AuthFile
  write(data: AuthFile): void
}
const defaultPath = (): string => join(homedir(), '.local', 'share', 'opencode', 'auth.json')
const defaultFs: FsSeam = {
  read: () => {
    try {
      return JSON.parse(readFileSync(defaultPath(), 'utf8')) as AuthFile
    } catch {
      return {}
    }
  },
  write: (data) => {
    const p = defaultPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 })
  },
}

export class OpencodeAuthenticator implements Authenticator {
  readonly id = 'opencode'
  readonly plane = 'model' as const

  constructor(private readonly fs: FsSeam = defaultFs) {}

  // opencode-go is key-based; the screen shows the key field. No device flow.
  begin(): Promise<AuthMode> {
    return Promise.resolve({ mode: 'apikey', label: 'opencode-go API key' })
  }

  submitKey(key: string): Promise<AuthStatus> {
    const data = this.fs.read()
    data[OPENCODE_GO] = { type: 'api', key: key.trim() }
    this.fs.write(data)
    return Promise.resolve('connected')
  }

  status(): Promise<AuthStatus> {
    const entry = this.fs.read()[OPENCODE_GO]
    return Promise.resolve(entry && entry.key ? 'connected' : 'disconnected')
  }

  // poll mirrors status — opencode has no in-flight device login.
  poll(): Promise<AuthStatus> {
    return this.status()
  }

  disconnect(): Promise<void> {
    const data = this.fs.read()
    delete data[OPENCODE_GO]
    this.fs.write(data)
    return Promise.resolve()
  }
}
