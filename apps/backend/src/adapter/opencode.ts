import { createOpencode } from '@opencode-ai/sdk'
import type { AgentCapabilities, ApprovalDecision } from '@trux/protocol'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'
import { OpencodeMapper, type OcEvent } from './opencode-map'

// The minimal opencode client surface trux uses. The real SDK client is cast to
// this at the boundary; the test injects a fake implementing it directly.
export interface OcClient {
  session: {
    create(o: { query: { directory: string }; body: Record<string, never> }): Promise<{ data?: { id?: string } }>
    promptAsync(o: { path: { id: string }; query: { directory: string }; body: { parts: { type: 'text'; text: string }[] } }): Promise<unknown>
    abort(o: { path: { id: string }; query: { directory: string } }): Promise<unknown>
  }
  postSessionIdPermissionsPermissionId(o: {
    path: { id: string; permissionID: string }
    query: { directory: string }
    body: { response: 'once' | 'always' | 'reject' }
  }): Promise<unknown>
  event: { subscribe(): Promise<{ stream: AsyncIterable<OcEvent> }> }
}

type CreateServer = () => Promise<{ client: OcClient; server: { close(): void } }>

// Opencode's native permission API has no session-scoped per-tool/per-command
// rules, so the graduated scopes degrade to the nearest equivalent: allow_edits /
// allow_command allow this single call ('once') rather than widening the grant.
const RESPONSE: Record<ApprovalDecision, 'once' | 'always' | 'reject'> = {
  allow: 'once',
  allow_always: 'always',
  allow_edits: 'once',
  allow_command: 'once',
  deny: 'reject',
}

const defaultCreateServer: CreateServer = async () => {
  const { client, server } = await createOpencode()
  return { client: client as unknown as OcClient, server }
}

export class OpencodeAdapter implements AgentAdapter {
  readonly name = 'opencode' as const

  // opencode declares no controls yet — wired in a follow-up. Empty manifest.
  capabilities(): AgentCapabilities {
    return { agent: 'opencode', models: [], defaultModel: null, controls: [] }
  }
  private serverP: Promise<{ client: OcClient }> | null = null
  private readonly routes = new Map<string, (e: OcEvent) => void>()

  constructor(private readonly createServer: CreateServer = defaultCreateServer) {}

  // Spawn the shared server once and start the global event demux loop.
  ensureServer(): Promise<{ client: OcClient }> {
    if (!this.serverP) {
      this.serverP = this.createServer().then(({ client }) => {
        void this.consume(client)
        return { client }
      })
    }
    return this.serverP
  }

  private async consume(client: OcClient): Promise<void> {
    const sub = await client.event.subscribe()
    for await (const e of sub.stream) {
      // Broadcast to every live session; each mapper filters by its sessionID.
      for (const route of this.routes.values()) route(e)
    }
  }

  register(sessionId: string, route: (e: OcEvent) => void): void {
    this.routes.set(sessionId, route)
  }
  unregister(sessionId: string): void {
    this.routes.delete(sessionId)
  }

  start({ cwd, resume }: { cwd: string; resume?: string }): AgentSession {
    return new OpencodeSession(this, cwd, resume)
  }
}

class OpencodeSession implements AgentSession {
  private readonly outbox = new PushQueue<AdapterEvent>()
  private readonly ready: Promise<void>
  private client: OcClient | null = null
  private ocId: string | null = null

  constructor(
    private readonly adapter: OpencodeAdapter,
    private readonly cwd: string,
    private readonly resume?: string,
  ) {
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    const { client } = await this.adapter.ensureServer()
    this.client = client
    if (this.resume) {
      this.ocId = this.resume
    } else {
      const res = await client.session.create({ query: { directory: this.cwd }, body: {} })
      this.ocId = res.data?.id ?? null
    }
    if (!this.ocId) {
      this.outbox.push({ type: 'error', message: 'opencode session create failed', recoverable: false })
      this.outbox.end()
      return
    }
    const mapper = new OpencodeMapper(this.ocId)
    this.adapter.register(this.ocId, (e) => {
      for (const ev of mapper.map(e)) this.outbox.push(ev)
    })
  }

  send(text: string): void {
    void this.ready
      .then(() => {
        if (!this.client || !this.ocId) return
        return this.client.session.promptAsync({
          path: { id: this.ocId },
          query: { directory: this.cwd },
          body: { parts: [{ type: 'text', text }] },
        })
      })
      .catch((err: unknown) => this.outbox.push({ type: 'error', message: String(err), recoverable: true }))
  }

  events(): AsyncIterable<AdapterEvent> {
    return this.outbox.iterable()
  }

  async interrupt(): Promise<void> {
    await this.ready
    if (this.client && this.ocId) {
      await this.client.session.abort({ path: { id: this.ocId }, query: { directory: this.cwd } })
    }
  }

  respondApproval(requestId: string, decision: ApprovalDecision): void {
    void this.ready.then(() => {
      if (!this.client || !this.ocId) return
      return this.client.postSessionIdPermissionsPermissionId({
        path: { id: this.ocId, permissionID: requestId },
        query: { directory: this.cwd },
        body: { response: RESPONSE[decision] },
      })
    })
  }

  nativeSessionId(): string | null {
    return this.ocId
  }

  async close(): Promise<void> {
    if (this.ocId) this.adapter.unregister(this.ocId)
    this.outbox.end()
  }
}
