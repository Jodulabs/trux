import type { AdapterEvent } from './types'

// Loosely-typed view of the opencode SSE events we read (the SDK Event union is
// huge; we narrow defensively at this untrusted boundary, like the Claude adapter).
export interface OcEvent {
  type: string
  properties?: Record<string, unknown>
}

interface OcTextPart {
  type: 'text'
  id: string
  sessionID: string
  text?: string
  time?: { end?: number }
}
interface OcToolPart {
  type: 'tool'
  id: string
  sessionID: string
  callID: string
  tool: string
  state: {
    status: 'pending' | 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    output?: string
    error?: string
  }
}

function errorMessage(error: unknown): string {
  if (!error) return 'session error'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return JSON.stringify(error)
}

// Pure, per-session, stateful translator: opencode Event → NCP AdapterEvents.
// State dedups opencode's repeated part updates (tool re-sends, text finalize).
export class OpencodeMapper {
  private readonly toolCalled = new Set<string>()
  private readonly toolResulted = new Set<string>()
  private readonly textFinalized = new Set<string>()

  constructor(private readonly sessionId: string) {}

  map(event: OcEvent): AdapterEvent[] {
    const props = (event.properties ?? {}) as Record<string, unknown>
    switch (event.type) {
      case 'message.part.updated': {
        const part = props.part as (OcTextPart | OcToolPart | { type: string; sessionID?: string }) | undefined
        if (!part || part.sessionID !== this.sessionId) return []
        if (part.type === 'text') return this.mapText(part as OcTextPart, props.delta)
        if (part.type === 'tool') return this.mapTool(part as OcToolPart)
        return []
      }
      case 'permission.updated': {
        if (props.sessionID !== this.sessionId) return []
        return [
          {
            type: 'approval_request',
            request_id: String(props.id ?? ''),
            tool: String(props.type ?? ''),
            input: (props.metadata as Record<string, unknown>) ?? {},
            explanation: typeof props.title === 'string' ? props.title : undefined,
          },
        ]
      }
      case 'session.idle': {
        if (props.sessionID !== this.sessionId) return []
        return [{ type: 'turn_complete', cost: null }]
      }
      case 'session.error': {
        if (props.sessionID != null && props.sessionID !== this.sessionId) return []
        return [{ type: 'error', message: errorMessage(props.error), recoverable: true }]
      }
      default:
        return []
    }
  }

  private mapText(part: OcTextPart, delta: unknown): AdapterEvent[] {
    const out: AdapterEvent[] = []
    if (typeof delta === 'string' && delta.length > 0) out.push({ type: 'text_delta', text: delta })
    if (part.time?.end != null && !this.textFinalized.has(part.id)) {
      this.textFinalized.add(part.id)
      out.push({ type: 'text', text: part.text ?? '' })
    }
    return out
  }

  private mapTool(part: OcToolPart): AdapterEvent[] {
    const out: AdapterEvent[] = []
    const { callID, tool, state } = part
    const emitCall = (): void => {
      if (!this.toolCalled.has(callID)) {
        this.toolCalled.add(callID)
        out.push({ type: 'tool_call', tool_id: callID, name: tool, input: state.input ?? {} })
      }
    }
    if (state.status === 'running') {
      emitCall()
    } else if (state.status === 'completed') {
      emitCall()
      if (!this.toolResulted.has(callID)) {
        this.toolResulted.add(callID)
        out.push({ type: 'tool_result', tool_id: callID, status: 'ok', output: state.output ?? '' })
      }
    } else if (state.status === 'error') {
      emitCall()
      if (!this.toolResulted.has(callID)) {
        this.toolResulted.add(callID)
        out.push({ type: 'tool_result', tool_id: callID, status: 'error', output: state.error ?? '' })
      }
    }
    return out
  }
}
