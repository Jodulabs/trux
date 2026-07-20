import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { AgentCapabilities, ApprovalDecision, TurnConfig } from '@trux/protocol'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'
import { PiMapper, type PiEvent, type PiMapState } from './pi-map'
import { PiDiscoverer, type RunFn } from '../discover'

export interface ChildProcessLike extends EventEmitter {
  readonly stdout: EventEmitter
  kill(signal?: string): boolean
}

export type SpawnFn = (args: string[], opts: { cwd: string }) => ChildProcessLike

const defaultSpawn: SpawnFn = (args, opts) =>
  spawn('pi', args, { cwd: opts.cwd }) as unknown as ChildProcessLike

// Pi has no native approval protocol. The capability is presented honestly:
// respondApproval is a no-op and Trux must not imply Pi executions are
// approval-gated. Track A spec §Approval behavior.
export class PiAdapter implements AgentAdapter {
  readonly name = 'pi' as const

  private readonly discoverer: PiDiscoverer

  constructor(
    private readonly spawnFn: SpawnFn = defaultSpawn,
    discoverRun?: RunFn,
  ) {
    this.discoverer = new PiDiscoverer(discoverRun)
  }

  // Models + thinking control discovered live from `pi --list-models`
  // (TTL-cached; empty manifest on failure → native default applies).
  capabilities(): AgentCapabilities {
    return this.discoverer.discover()
  }

  start(opts: { cwd: string; resume?: string; config?: TurnConfig }): AgentSession {
    return new PiSession(this.spawnFn, opts.cwd, opts.resume ?? null, opts.config ?? null)
  }
}

class PiSession implements AgentSession {
  private readonly outbox = new PushQueue<AdapterEvent>()
  private readonly mapState: PiMapState
  private readonly mapper: PiMapper
  private activeProc: ChildProcessLike | null = null
  private readonly config: TurnConfig | null

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly cwd: string,
    resume: string | null,
    config: TurnConfig | null,
  ) {
    this.mapState = { sessionId: resume }
    this.mapper = new PiMapper(this.mapState)
    this.config = config
  }

  send(text: string, _attachments?: unknown): void {
    // Per-turn spawn, matching the Codex process pattern. cwd is the spawn
    // working directory; resume is carried by --session. Model and thinking
    // map onto pi's --model and --thinking flags; empty/absent = omit (native
    // default applies). No Pi npm dependency.
    const args: string[] = ['--mode', 'json']
    if (this.config?.model) args.push('--model', this.config.model)
    const thinking = this.config?.options?.thinking
    if (thinking) args.push('--thinking', thinking)
    if (this.mapState.sessionId) args.push('--session', this.mapState.sessionId)
    args.push(text)

    const proc = this.spawnFn(args, { cwd: this.cwd })
    this.activeProc = proc

    let buf = ''
    let turnCompleted = false
    let errored = false

    proc.stdout.on('data', (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let event: PiEvent
        try {
          event = JSON.parse(trimmed) as PiEvent
        } catch {
          continue
        }
        if (event.type === 'turn_end') turnCompleted = true
        if (event.type === 'error') errored = true
        for (const e of this.mapper.map(event)) this.outbox.push(e)
      }
    })

    proc.on('close', (code: number | null) => {
      // Flush any trailing partial line.
      if (buf.trim()) {
        try {
          const event = JSON.parse(buf.trim()) as PiEvent
          if (event.type === 'turn_end') turnCompleted = true
          if (event.type === 'error') errored = true
          for (const e of this.mapper.map(event)) this.outbox.push(e)
        } catch {
          // ignore malformed trailing line
        }
      }
      // Abnormal close (non-zero, no turn_end, no explicit error event):
      // surface a recoverable error so the manager transitions to idle rather
      // than hanging on a turn that will never complete.
      if (!turnCompleted && !errored && code !== 0) {
        this.outbox.push({
          type: 'error',
          message: `pi process exited with code ${code ?? 'null'}`,
          recoverable: true,
        })
      }
      // Always close the turn so the manager returns to idle; without a
      // turn_complete it would wait forever for a process that has exited.
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

  // No-op: Pi has no native per-tool approval protocol.
  respondApproval(_requestId: string, _decision: ApprovalDecision): void {}

  nativeSessionId(): string | null {
    return this.mapState.sessionId
  }

  async close(): Promise<void> {
    this.activeProc?.kill('SIGTERM')
    this.outbox.end()
  }
}
