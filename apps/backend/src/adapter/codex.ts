import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { ApprovalDecision } from '@trux/protocol'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'
import { mapCodexLine, type CodexMapState, type CodexEvent } from './codex-map'

export interface ChildProcessLike extends EventEmitter {
  readonly stdout: EventEmitter
  kill(signal?: string): boolean
}

export type SpawnFn = (args: string[], opts: { cwd: string }) => ChildProcessLike

const defaultSpawn: SpawnFn = (args, opts) =>
  spawn('codex', args, { cwd: opts.cwd }) as unknown as ChildProcessLike

export class CodexAdapter implements AgentAdapter {
  readonly name = 'codex' as const

  constructor(private readonly spawnFn: SpawnFn = defaultSpawn) {}

  start(opts: { cwd: string; resume?: string }): AgentSession {
    return new CodexSession(this.spawnFn, opts.cwd, opts.resume ?? null)
  }
}

class CodexSession implements AgentSession {
  private readonly outbox = new PushQueue<AdapterEvent>()
  private readonly mapState: CodexMapState
  private activeProc: ChildProcessLike | null = null

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly cwd: string,
    resume: string | null,
  ) {
    this.mapState = { threadId: resume }
  }

  send(text: string): void {
    const args = this.mapState.threadId
      ? ['exec', 'resume', '--json', this.mapState.threadId, text]
      : ['exec', '--json', '-C', this.cwd, '-s', 'workspace-write', text]

    const proc = this.spawnFn(args, { cwd: this.cwd })
    this.activeProc = proc

    let buf = ''
    let turnCompleted = false

    proc.stdout.on('data', (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let event: CodexEvent
        try {
          event = JSON.parse(trimmed) as CodexEvent
        } catch {
          continue
        }
        if (event.type === 'turn.completed') turnCompleted = true
        for (const e of mapCodexLine(event, this.mapState)) this.outbox.push(e)
      }
    })

    proc.on('close', () => {
      if (buf.trim()) {
        try {
          const event = JSON.parse(buf.trim()) as CodexEvent
          if (event.type === 'turn.completed') turnCompleted = true
          for (const e of mapCodexLine(event, this.mapState)) this.outbox.push(e)
        } catch {
          // ignore malformed trailing line
        }
      }
      if (!turnCompleted) this.outbox.push({ type: 'turn_complete', cost: null })
      if (this.activeProc === proc) this.activeProc = null
    })
  }

  events(): AsyncIterable<AdapterEvent> {
    return this.outbox.iterable()
  }

  async interrupt(): Promise<void> {
    this.activeProc?.kill('SIGTERM')
  }

  // Codex uses sandbox policy at spawn time — no per-tool approval loop.
  respondApproval(_requestId: string, _decision: ApprovalDecision): void {}

  nativeSessionId(): string | null {
    return this.mapState.threadId
  }

  async close(): Promise<void> {
    this.activeProc?.kill('SIGTERM')
    this.outbox.end()
  }
}
