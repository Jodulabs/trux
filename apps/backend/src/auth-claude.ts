import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'
import { parseClaudeSetupOutput, parseClaudeStatus } from './auth-provider'
import { type AuthChild, type SpawnFn } from './auth-codex'

const defaultSpawn: SpawnFn = (cmd, args) => spawn(cmd, args) as unknown as AuthChild

// Read the OAuth credential file to surface expiry. Injected for tests.
export type ReadCredsFn = () => { expiresAt?: number } | null
const defaultReadCreds: ReadCredsFn = () => {
  try {
    const raw = readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8')
    return (JSON.parse(raw) as { claudeAiOauth?: { expiresAt?: number } }).claudeAiOauth ?? null
  } catch {
    return null
  }
}

export class ClaudeAuthenticator implements Authenticator {
  readonly id = 'claude'
  readonly plane = 'model' as const

  // The in-flight setup-token child (awaiting a pasted code) + its reached status.
  private child: AuthChild | null = null
  private flowStatus: AuthStatus = 'disconnected'

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    private readonly readCreds: ReadCredsFn = defaultReadCreds,
  ) {}

  begin(): Promise<AuthMode> {
    this.child?.kill()
    const child = this.spawnFn('claude', ['setup-token'])
    this.child = child
    this.flowStatus = 'pending'
    let buf = ''
    return new Promise<AuthMode>((resolve, reject) => {
      let settled = false
      const onData = (d: Buffer): void => {
        buf += d.toString()
        const parsed = parseClaudeSetupOutput(buf)
        if (parsed && !settled) {
          settled = true
          resolve({ mode: 'device', verifyUrl: parsed.verifyUrl, userCode: null, needsCode: true })
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('exit', (code: number) => {
        this.flowStatus = code === 0 ? 'connected' : 'disconnected'
        this.child = null
        if (!settled) {
          settled = true
          reject(new Error('claude setup-token exited before printing a sign-in URL'))
        }
      })
    })
  }

  // After the user signs in and gets a code, they paste it; feed it to the held
  // child's stdin. Resolve once the child stores creds and exits.
  submitCode(code: string): Promise<AuthStatus> {
    const child = this.child
    if (!child) return Promise.resolve('disconnected')
    return new Promise<AuthStatus>((resolve) => {
      child.on('exit', (c: number) => {
        this.flowStatus = c === 0 ? 'connected' : 'disconnected'
        this.child = null
        resolve(this.flowStatus)
      })
      child.stdin.write(code.trim() + '\n')
      child.stdin.end()
    })
  }

  async poll(): Promise<AuthStatus> {
    if (this.child) return 'pending'
    return this.flowStatus === 'connected' ? 'connected' : this.status()
  }

  async status(): Promise<AuthStatus> {
    const base = await this.run(['auth', 'status']).then((o) => parseClaudeStatus(o)).catch((): AuthStatus => 'disconnected')
    if (base !== 'connected') return base
    // Connected per the CLI — surface expiry from the credential file if past.
    const creds = this.readCreds()
    if (creds?.expiresAt && creds.expiresAt < Date.now()) return 'expired'
    return 'connected'
  }

  async disconnect(): Promise<void> {
    this.child?.kill()
    this.child = null
    this.flowStatus = 'disconnected'
    await this.run(['auth', 'logout']).catch(() => undefined)
  }

  private run(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnFn('claude', args)
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('exit', (code: number) => (code === 0 ? resolve(out) : reject(new Error(`claude ${args.join(' ')} exited ${code}`))))
    })
  }
}
