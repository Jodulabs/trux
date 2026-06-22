import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { AuthMode, AuthStatus, Authenticator } from './auth-provider'
import { parseCodexDeviceOutput, parseCodexStatus } from './auth-provider'

// Injectable child seam (mirrors adapter/codex.ts SpawnFn + terminal.ts SpawnPty).
export interface AuthChild extends EventEmitter {
  readonly stdout: EventEmitter
  readonly stderr: EventEmitter
  readonly stdin: { write(s: string): void; end(): void }
  kill(signal?: string): boolean
}
export type SpawnFn = (cmd: string, args: string[]) => AuthChild

const defaultSpawn: SpawnFn = (cmd, args) => spawn(cmd, args) as unknown as AuthChild

export class CodexAuthenticator implements Authenticator {
  readonly id = 'codex'
  readonly plane = 'model' as const

  // The in-flight device-login child + the status it has reached. Only one login
  // runs at a time; a new begin() kills any prior child (the CLI clears auth.json
  // on start anyway — see the findings note).
  private child: AuthChild | null = null
  private deviceStatus: AuthStatus = 'disconnected'

  constructor(private readonly spawnFn: SpawnFn = defaultSpawn) {}

  begin(): Promise<AuthMode> {
    this.child?.kill()
    const child = this.spawnFn('codex', ['login', '--device-auth'])
    this.child = child
    this.deviceStatus = 'pending'
    let buf = ''
    return new Promise<AuthMode>((resolve, reject) => {
      let settled = false
      const onData = (d: Buffer): void => {
        buf += d.toString()
        const parsed = parseCodexDeviceOutput(buf)
        if (parsed && !settled) {
          settled = true
          resolve({ mode: 'device', verifyUrl: parsed.verifyUrl, userCode: parsed.userCode })
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData) // some CLIs print the URL to stderr
      child.on('exit', (code: number) => {
        this.deviceStatus = code === 0 ? 'connected' : 'disconnected'
        this.child = null
        if (!settled) {
          settled = true
          reject(new Error('codex login exited before printing a verification URL'))
        }
      })
    })
  }

  // The held child reports progress: pending while it runs, connected/disconnected
  // once it exits. Falls back to the persisted status when no login is in flight.
  async poll(): Promise<AuthStatus> {
    if (this.child) return 'pending'
    return this.deviceStatus === 'connected' ? 'connected' : this.status()
  }

  status(): Promise<AuthStatus> {
    return this.run(['login', 'status']).then((out) => parseCodexStatus(out)).catch(() => 'disconnected')
  }

  submitKey(key: string): Promise<AuthStatus> {
    return new Promise<AuthStatus>((resolve) => {
      const child = this.spawnFn('codex', ['login', '--with-api-key'])
      child.on('exit', (code: number) => resolve(code === 0 ? 'connected' : 'disconnected'))
      child.stdin.write(key.trim() + '\n')
      child.stdin.end()
    })
  }

  async disconnect(): Promise<void> {
    this.child?.kill()
    this.child = null
    this.deviceStatus = 'disconnected'
    await this.run(['logout']).catch(() => undefined)
  }

  // Run a codex subcommand to completion, collecting stdout.
  private run(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnFn('codex', args)
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('exit', (code: number) => (code === 0 ? resolve(out) : reject(new Error(`codex ${args.join(' ')} exited ${code}`))))
    })
  }
}
