import { randomUUID } from 'node:crypto'
import type { ApprovalDecision, ServerEvent } from '@trux/protocol'
import type { AdapterEvent, AgentAdapter, AgentSession } from './adapter/types'
import { detectPort } from './ports'
import type { SqliteRegistry } from './registry'

type Listener = (event: ServerEvent) => void

interface LiveSession {
  session: AgentSession
  currentTurnId: string | null
  lastPort: number | null
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

  constructor(
    private readonly registry: SqliteRegistry,
    private readonly adapter: AgentAdapter,
  ) {}

  attach(convId: string, listener: Listener): () => void {
    const set = this.listeners.get(convId) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(convId, set)
    return () => set.delete(listener)
  }

  async handleUserMessage(convId: string, text: string): Promise<void> {
    const live = this.ensureSession(convId)
    const turnId = `t_${randomUUID().slice(0, 8)}`
    live.currentTurnId = turnId
    this.emit(convId, { type: 'user_text', turn_id: turnId, text })
    this.emit(convId, { type: 'turn_started', turn_id: turnId })
    this.emit(convId, { type: 'status', state: 'thinking' })
    live.session.send(text)
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

  private ensureSession(convId: string): LiveSession {
    const existing = this.live.get(convId)
    if (existing) return existing
    const conv = this.registry.getConversation(convId)
    if (!conv) throw new Error(`unknown conversation ${convId}`)
    const session = this.adapter.start({
      cwd: conv.cwd,
      resume: conv.native_session_id ?? undefined,
    })
    const live: LiveSession = { session, currentTurnId: null, lastPort: null }
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
          this.emit(convId, { type: 'status', state: 'idle' })
          live.currentTurnId = null
        }
      }
    } catch (err) {
      this.emit(convId, { type: 'error', message: String(err), recoverable: true })
      this.emit(convId, { type: 'status', state: 'error' })
    }
  }

  // Persist (everything but text_delta) then broadcast to attached sockets.
  private emit(convId: string, event: ServerEvent): void {
    if (event.type !== 'text_delta') {
      this.registry.appendEvent(convId, event)
      if (event.type === 'status') this.registry.setStatus(convId, event.state)
    }
    for (const listener of this.listeners.get(convId) ?? []) listener(event)
  }
}
