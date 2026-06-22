import * as nodePty from 'node-pty'

// --- wire protocol: a lightweight channel, deliberately separate from
// @trux/protocol (which versions the agent conversation). ---
export type TerminalClientMsg =
  | { type: 'auth'; token: string | null }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
export type TerminalServerMsg =
  | { type: 'ready' }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string }

// --- PTY seam (injectable for tests; mirrors the codex adapter's SpawnFn). ---
export interface PtyLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}
export type SpawnPty = (opts: { cwd: string; cols: number; rows: number }) => PtyLike

const defaultSpawnPty: SpawnPty = ({ cwd, cols, rows }) =>
  nodePty.spawn(process.env.SHELL || 'bash', [], {
    name: 'xterm-color',
    cwd,
    cols,
    rows,
    env: process.env as Record<string, string>,
  }) as unknown as PtyLike

// The surface the route consumes; TerminalSession implements it, the route test fakes it.
export interface TerminalLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export class TerminalSession implements TerminalLike {
  private readonly pty: PtyLike
  constructor(cwd: string, spawnPty: SpawnPty = defaultSpawnPty, size: { cols: number; rows: number } = { cols: 80, rows: 24 }) {
    this.pty = spawnPty({ cwd, cols: size.cols, rows: size.rows })
  }
  onData(cb: (data: string) => void): void { this.pty.onData(cb) }
  onExit(cb: (code: number) => void): void { this.pty.onExit((e) => cb(e.exitCode)) }
  write(data: string): void { this.pty.write(data) }
  resize(cols: number, rows: number): void { this.pty.resize(cols, rows) }
  kill(): void { this.pty.kill() }
}
