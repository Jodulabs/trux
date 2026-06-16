import type { AgentName, ToolResultStatus } from '@trux/protocol'

// NCP events as the adapter produces them: no turn_id (a conversation concern the
// manager stamps) and no seq (allocated by the registry).
export type AdapterEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool_id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_id: string; status: ToolResultStatus; output: string }
  | { type: 'turn_complete'; usage?: { input: number; output: number }; cost?: number | null }
  | { type: 'error'; message: string; recoverable: boolean }

export interface AgentSession {
  send(text: string): void
  events(): AsyncIterable<AdapterEvent>
  interrupt(): Promise<void>
  close(): Promise<void>
  nativeSessionId(): string | null
}

export interface AgentAdapter {
  readonly name: AgentName
  start(opts: { cwd: string; resume?: string }): AgentSession
}
