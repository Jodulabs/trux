import type { AdapterEvent } from './types'

export interface CodexEvent {
  type: string
  [k: string]: unknown
}

export interface CodexMapState {
  threadId: string | null
}

export function mapCodexLine(event: CodexEvent, state: CodexMapState): AdapterEvent[] {
  switch (event.type) {
    case 'thread.started': {
      if (typeof event.thread_id === 'string') state.threadId = event.thread_id
      return []
    }
    case 'item.started': {
      const item = event.item as Record<string, unknown> | undefined
      if (!item || item.type !== 'command_execution') return []
      return [{ type: 'tool_call', tool_id: String(item.id ?? ''), name: 'bash', input: { command: String(item.command ?? '') } }]
    }
    case 'item.completed': {
      const item = event.item as Record<string, unknown> | undefined
      if (!item) return []
      if (item.type === 'agent_message') {
        return [{ type: 'text', text: String(item.text ?? '') }]
      }
      if (item.type === 'command_execution') {
        const status = item.exit_code === 0 ? 'ok' : ('error' as const)
        return [{ type: 'tool_result', tool_id: String(item.id ?? ''), status, output: String(item.aggregated_output ?? '') }]
      }
      if (item.type === 'error') {
        return [{ type: 'error', message: String(item.message ?? 'codex error'), recoverable: true }]
      }
      return []
    }
    case 'turn.completed': {
      const usage = event.usage as Record<string, unknown> | undefined
      return [{
        type: 'turn_complete',
        usage: usage ? { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) } : undefined,
        cost: null,
      }]
    }
    default:
      return []
  }
}
