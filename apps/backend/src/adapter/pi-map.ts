import type { AdapterEvent } from './types'

// Loosely-typed view of a Pi `--mode json` line. Pi emits one JSON object per
// line; the shapes we care about are listed in the spec (Track A). Everything
// else is narrowed defensively at this untrusted boundary, like codex/opencode.
export interface PiEvent {
  type: string
  [k: string]: unknown
}

export interface PiMapState {
  sessionId: string | null
}

// Tool lifecycle dedup: Pi may re-emit tool_execution_start/end for the same
// native tool-call id across retries or progress updates. Emit each transition
// at most once per id.
export class PiMapper {
  private readonly toolCalled = new Set<string>()
  private readonly toolResulted = new Set<string>()

  constructor(private readonly state: PiMapState) {}

  map(event: PiEvent): AdapterEvent[] {
    switch (event.type) {
      case 'session': {
        // Pi's session header: capture the native session id, emit nothing.
        const id = event.session_id ?? event.id
        if (typeof id === 'string') this.state.sessionId = id
        return []
      }
      case 'message_update': {
        // Assistant streaming. The delta mirrors the Anthropic shape:
        // { type: 'text_delta', text: '...' }.
        const delta = event.delta as { type?: string; text?: string } | undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          return [{ type: 'text_delta', text: delta.text }]
        }
        return []
      }
      case 'message_end': {
        // Final assistant text for the message. The transcript layer prefers a
        // terminating `text` event so the rendered block isn't only deltas.
        const text = this.extractFinalText(event)
        if (text === null) return []
        return [{ type: 'text', text }]
      }
      case 'tool_execution_start': {
        const id = String(event.tool_call_id ?? event.id ?? '')
        if (!id || this.toolCalled.has(id)) return []
        this.toolCalled.add(id)
        return [{
          type: 'tool_call',
          tool_id: id,
          name: String(event.tool_name ?? event.name ?? ''),
          input: (event.input as Record<string, unknown>) ?? {},
        }]
      }
      case 'tool_execution_end': {
        const id = String(event.tool_call_id ?? event.id ?? '')
        if (!id || this.toolResulted.has(id)) return []
        this.toolResulted.add(id)
        const status = this.toolStatus(event)
        return [{
          type: 'tool_result',
          tool_id: id,
          status,
          output: this.toolOutput(event),
        }]
      }
      case 'turn_end': {
        const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
        return [{
          type: 'turn_complete',
          usage: usage ? { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) } : undefined,
          cost: typeof event.cost_usd === 'number' ? event.cost_usd : null,
        }]
      }
      case 'error': {
        return [{ type: 'error', message: String(event.message ?? 'pi error'), recoverable: true }]
      }
      default:
        return []
    }
  }

  private extractFinalText(event: PiEvent): string | null {
    if (typeof event.text === 'string') return event.text
    const message = event.message as { content?: unknown } | undefined
    const content = message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      const texts: string[] = []
      for (const block of content) {
        const b = block as Record<string, unknown> | undefined
        if (b && b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
      }
      if (texts.length > 0) return texts.join('')
    }
    return null
  }

  private toolStatus(event: PiEvent): 'ok' | 'error' {
    const raw = event.status ?? event.exit_code
    if (raw === 'error' || raw === 'failed') return 'error'
    if (typeof raw === 'number' && raw !== 0) return 'error'
    return 'ok'
  }

  private toolOutput(event: PiEvent): string {
    if (typeof event.output === 'string') return event.output
    if (typeof event.result === 'string') return event.result
    const output = event.output as Record<string, unknown> | undefined
    if (output && typeof output.text === 'string') return output.text
    return ''
  }
}
