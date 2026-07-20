import type { AgentCapabilities, AgentName, ApprovalDecision, ImageAttachment, ToolResultStatus, TurnConfig } from '@trux/protocol'

// NCP events as the adapter produces them: no turn_id (a conversation concern the
// manager stamps) and no seq (allocated by the registry).
export type AdapterEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; tool_id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_id: string; status: ToolResultStatus; output: string; images?: ImageAttachment[] }
  | { type: 'approval_request'; request_id: string; tool: string; input: unknown; explanation?: string }
  | { type: 'turn_complete'; usage?: { input: number; output: number }; cost?: number | null }
  | { type: 'error'; message: string; recoverable: boolean }

// Validate that a config value is safe to pass as a CLI argument. Rejects
// values starting with '-' (flag injection), empty strings, and overly long
// values (resource guard). Returns the trimmed value or null if unsafe/empty.
//
// Why: config.model and config.options.* come from user input (the mobile
// composer). Without validation, a model name like `--foo` would be parsed by
// the CLI as a flag rather than a value, enabling argument injection even
// though spawn() doesn't use a shell.
export function safeCliArg(value: string | null | undefined, maxLen = 256): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('-')) return null
  if (trimmed.length > maxLen) return null
  return trimmed
}

// Validate every opaque option value in a TurnConfig against the same rule.
// Returns a cleaned options map with unsafe values dropped.
export function safeOptions(config: TurnConfig | null | undefined, maxLen = 256): Record<string, string> {
  if (!config?.options) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(config.options)) {
    const safe = safeCliArg(v, maxLen)
    if (safe) out[k] = safe
  }
  return out
}

export interface AgentSession {
  send(text: string, attachments?: ImageAttachment[], config?: TurnConfig): void
  events(): AsyncIterable<AdapterEvent>
  interrupt(): Promise<void>
  close(): Promise<void>
  nativeSessionId(): string | null
  respondApproval(requestId: string, decision: ApprovalDecision, note?: string | null): void
}

export interface AgentAdapter {
  readonly name: AgentName
  capabilities(): Promise<AgentCapabilities>
  start(opts: { cwd: string; resume?: string; config?: TurnConfig }): AgentSession
}
