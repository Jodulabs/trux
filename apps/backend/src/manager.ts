import { randomUUID } from 'node:crypto'
import type { AgentCapabilities, AgentName, ApprovalDecision, ImageAttachment, ServerEvent, TurnConfig } from '@trux/protocol'
import type { AdapterEvent, AgentAdapter, AgentSession } from './adapter/types'
import { detectPort } from './ports'
import type { SqliteRegistry } from './registry'
import type { NotifyInput } from './push'

type Listener = (event: ServerEvent) => void

// The push seam: the manager calls this when a closed PWA should be pulled back
// (an approval it's blocked on, a finished turn). Optional — null disables push.
export interface Notifier {
  notify(input: NotifyInput): Promise<void>
}

// Beyond this many missed events, a reconnecting client gets a full snapshot to
// fold from scratch rather than a delta — cheaper than streaming a huge backlog.
const SNAPSHOT_THRESHOLD = 200

interface LiveSession {
  session: AgentSession
  currentTurnId: string | null
  lastPort: number | null
  // client_message_ids already processed this process-lifetime, so a reconnect
  // outbox flush can't run the same turn twice (the echo may not have reached the
  // client before the socket dropped). Persisted user_text is also checked, so
  // this survives a process restart via the transcript.
  seenMessageIds: Set<string>
}

// Stamp an adapter event (no turn_id) into a wire ServerEvent for the open turn.
function stampTurn(e: AdapterEvent, turnId: string): ServerEvent {
  switch (e.type) {
    case 'text_delta':
      return { type: 'text_delta', turn_id: turnId, text: e.text }
    case 'text':
      return { type: 'text', turn_id: turnId, text: e.text }
    case 'tool_call':
      return { type: 'tool_call', turn_id: turnId, tool_id: e.tool_id, name: e.name, input: e.input }
    case 'tool_result':
      return {
        type: 'tool_result',
        turn_id: turnId,
        tool_id: e.tool_id,
        status: e.status,
        output: e.output,
        ...(e.images ? { images: e.images } : {}),
      }
    case 'approval_request':
      return {
        type: 'approval_request',
        turn_id: turnId,
        request_id: e.request_id,
        tool: e.tool,
        input: e.input,
        explanation: e.explanation,
      }
    case 'turn_complete':
      return { type: 'turn_complete', turn_id: turnId, usage: e.usage, cost: e.cost }
    case 'error':
      return { type: 'error', message: e.message, recoverable: e.recoverable }
  }
}

// The single bridge: WS ↔ adapter ↔ registry. Owns turn ids, status, and the
// persist-before-broadcast ordering (text_delta is broadcast-only).
export class ConversationManager {
  private live = new Map<string, LiveSession>()
  private listeners = new Map<string, Set<Listener>>()
  // Synchronous per-conversation claim for the single-driver guard. Set BEFORE
  // any await in handleUserMessage so concurrent callers see the claim and get
  // rejected. Released in the finally block after the turn is dispatched.
  private claimed = new Set<string>()

  constructor(
    private readonly registry: SqliteRegistry,
    private readonly adapters: Map<AgentName, AgentAdapter>,
    private readonly notifier: Notifier | null = null,
  ) {}

  attach(convId: string, listener: Listener): () => void {
    const set = this.listeners.get(convId) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(convId, set)
    return () => set.delete(listener)
  }

  availableAgents(): AgentName[] {
    return [...this.adapters.keys()]
  }

  async capabilities(): Promise<AgentCapabilities[]> {
    const entries = await Promise.all([...this.adapters.values()].map((a) => a.capabilities()))
    return entries
  }

  async handleUserMessage(
    convId: string,
    text: string,
    attachments?: ImageAttachment[],
    clientMessageId?: string,
    config?: TurnConfig,
  ): Promise<void> {
    // Single-driver guard: reject if another client (or this one) already started
    // a turn and the conversation is not idle. Prevents parallel turns when two
    // surfaces are attached to the same conversation.
    //
    // The guard must be SYNCHRONOUS — no awaits between the idle check and
    // marking the conversation as claimed. Otherwise two concurrent calls both
    // see 'idle', both pass the guard, and both proceed to start a turn. We use
    // an in-memory claim Set as a synchronous second layer (the registry status
    // write is also synchronous but the in-memory set is bulletproof against
    // any future code that might await between check and claim).
    if (this.claimed.has(convId)) {
      this.emit(convId, { type: 'error', message: 'conversation busy', recoverable: true })
      return
    }
    const status = this.registry.getConversation(convId)?.status
    if (status && status !== 'idle') {
      this.emit(convId, { type: 'error', message: 'conversation busy', recoverable: true })
      return
    }
    // Claim the conversation synchronously before any await. This is the
    // critical section — no awaits between the idle check and this claim.
    this.claimed.add(convId)
    try {
      // Persist the selection first (sticky) so ensureSession reads the latest one
      // when it creates a fresh session for this conversation.
      const existing = this.live.get(convId)
      const priorConfig = this.liveConfig(convId)
      if (config) this.registry.setConfig(convId, config)
      // If the incoming config differs from the one baked into the live session,
      // tear down + recreate so the new model/effort/thinking take effect on this
      // turn. The native_session_id is preserved for resume (the agent's own
      // conversation continuity), but the process/query handle is rebuilt so the
      // SDK sees the new knobs. Only safe when the prior turn is idle.
      if (existing && priorConfig && config && this.configsDiffer(priorConfig, config)) {
        const conv = this.registry.getConversation(convId)
        if (conv && conv.status === 'idle') {
          await existing.session.close().catch(() => {})
          this.live.delete(convId)
        }
      }
      const live = this.ensureSession(convId)
      if (!live) {
        this.emit(convId, {
          type: 'error',
          message: "no adapter for this conversation's agent",
          recoverable: false,
        })
        return
      }
      // Idempotency: a reconnect outbox flush can replay a message the server
      // already ran (the user_text echo may not have reached the client before the
      // socket dropped). Drop the duplicate; the original is replayed via resume.
      if (clientMessageId && live.seenMessageIds.has(clientMessageId)) return
      if (clientMessageId) live.seenMessageIds.add(clientMessageId)
      const turnId = `t_${randomUUID().slice(0, 8)}`
      live.currentTurnId = turnId
      this.emit(convId, {
        type: 'user_text',
        turn_id: turnId,
        text,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
      })
      this.emit(convId, { type: 'turn_started', turn_id: turnId })
      this.emit(convId, { type: 'status', state: 'thinking' })
      live.session.send(text, attachments, config)
    } finally {
      // Release the claim so the next turn can start. The 'thinking' status
      // persists in the registry until the pump flips it back to 'idle' on
      // turn_complete; the in-memory claim is just the synchronous guard.
      this.claimed.delete(convId)
    }
  }

  async interrupt(convId: string): Promise<void> {
    await this.live.get(convId)?.session.interrupt()
  }

  async handleApprovalResponse(
    convId: string,
    requestId: string,
    decision: ApprovalDecision,
    note: string | null,
  ): Promise<void> {
    const live = this.live.get(convId)
    if (!live) return
    live.session.respondApproval(requestId, decision, note)
    this.emit(convId, { type: 'status', state: 'thinking' })
  }

  // Replay what a reconnecting client missed. Normally a history_delta of events
  // with seq > sinceSeq; if the gap is large (or the client is far behind / fresh)
  // send a history_snapshot the client folds from scratch instead.
  replaySince(convId: string, sinceSeq: number, listener: Listener): void {
    const missed = this.registry
      .loadTranscriptSince(convId, sinceSeq)
      .map((s) => ({ ...s.event, seq: s.seq }))
    if (missed.length > SNAPSHOT_THRESHOLD) {
      const all = this.registry.loadTranscript(convId).map((s) => ({ ...s.event, seq: s.seq }))
      listener({ type: 'history_snapshot', events: all })
      return
    }
    listener({ type: 'history_delta', events: missed })
  }

  // Fire a push for a conversation, tagging the payload with convId so the SW can
  // deep-link. Swallows errors — a push failure must never break the turn pump.
  private async pushNotify(convId: string, input: Omit<NotifyInput, 'conversationId'>): Promise<void> {
    if (!this.notifier) return
    try {
      await this.notifier.notify({ conversationId: convId, ...input })
    } catch {
      // best-effort
    }
  }

  private convTitle(convId: string): string {
    const conv = this.registry.getConversation(convId)
    return conv?.title ?? 'trux'
  }

  // A short, human one-liner for the notification body (the command / file path).
  private approvalBody(tool: string, input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const o = input as Record<string, unknown>
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const raw = str(o.command) || str(o.file_path) || str(o.path) || str(o.pattern) || str(o.url) || tool
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw
  }

  // Snapshot the config baked into the live session (if any), read from the
  // persisted conversation BEFORE a new setConfig overwrites it. Used to detect
  // "the user changed the model/effort/trust for this turn" so we can rebuild
  // the session.
  private liveConfig(convId: string): TurnConfig | null {
    if (!this.live.has(convId)) return null
    const conv = this.registry.getConversation(convId)
    if (!conv) return null
    return { model: conv.model, options: { ...conv.options }, trust: conv.trust ?? undefined }
  }

  // Does the incoming per-turn config differ from what the live session was
  // built with? Compares the parts the adapter reads at start() time: model,
  // opaque options, and trust. Triggers a session rebuild so new knobs apply.
  private configsDiffer(prev: TurnConfig, incoming: TurnConfig): boolean {
    if ((prev.model ?? null) !== (incoming.model ?? null)) return true
    if ((prev.trust ?? null) !== (incoming.trust ?? null)) return true
    const a = prev.options ?? {}, b = incoming.options ?? {}
    const ak = Object.keys(a), bk = Object.keys(b)
    if (ak.length !== bk.length) return true
    return ak.some((k) => a[k] !== b[k])
  }

  private ensureSession(convId: string): LiveSession | null {
    const existing = this.live.get(convId)
    if (existing) return existing
    const conv = this.registry.getConversation(convId)
    if (!conv) throw new Error(`unknown conversation ${convId}`)
    const adapter = this.adapters.get(conv.agent)
    if (!adapter) return null
    const session = adapter.start({
      cwd: conv.cwd,
      resume: conv.native_session_id ?? undefined,
      config: { model: conv.model, options: conv.options, trust: conv.trust ?? undefined },
    })
    const live: LiveSession = {
      session,
      currentTurnId: null,
      lastPort: null,
      // Seed from persisted history so idempotency survives a process restart.
      seenMessageIds: new Set(this.registry.seenMessageIds(convId)),
    }
    this.live.set(convId, live)
    void this.pump(convId, live)
    return live
  }

  private async pump(convId: string, live: LiveSession): Promise<void> {
    try {
      for await (const e of live.session.events()) {
        const wire = stampTurn(e, live.currentTurnId ?? '')
        this.emit(convId, wire)
        if (wire.type === 'approval_request') {
          this.emit(convId, { type: 'status', state: 'awaiting_approval' })
          void this.pushNotify(convId, {
            kind: 'approval',
            dedupeKey: `approval:${wire.request_id}`,
            title: this.convTitle(convId),
            body: `${wire.tool}: ${this.approvalBody(wire.tool, wire.input)}`,
          })
        }
        if (wire.type === 'tool_result' || wire.type === 'text') {
          const port = detectPort(wire.type === 'tool_result' ? wire.output : wire.text)
          if (port !== null && port !== live.lastPort) {
            live.lastPort = port
            this.emit(convId, { type: 'port_detected', port })
          }
        }
        if (wire.type === 'turn_complete') {
          const sid = live.session.nativeSessionId()
          if (sid) this.registry.setNativeSessionId(convId, sid)
          void this.pushNotify(convId, {
            kind: 'turn',
            dedupeKey: `turn:${wire.turn_id}`,
            title: this.convTitle(convId),
            body: 'Turn complete',
          })
          this.emit(convId, { type: 'status', state: 'idle' })
          live.currentTurnId = null
        }
      }
    } catch (err) {
      this.emit(convId, { type: 'error', message: String(err), recoverable: true })
      this.emit(convId, { type: 'status', state: 'error' })
    }
  }

  // Persist (everything but text_delta) then broadcast to attached sockets. The
  // persisted seq is stamped onto the broadcast event so clients can track what
  // they've seen and ask for deltas on reconnect (text_delta stays unsequenced).
  private emit(convId: string, event: ServerEvent): void {
    let wire = event
    if (event.type !== 'text_delta') {
      const { seq } = this.registry.appendEvent(convId, event)
      wire = { ...event, seq }
      if (event.type === 'status') this.registry.setStatus(convId, event.state)
    }
    for (const listener of this.listeners.get(convId) ?? []) listener(wire)
  }
}
