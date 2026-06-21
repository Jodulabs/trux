// Vendored type definitions from happy (slopus/happy, MIT).
// Re-skinned for trux: only the subset the tool-view substrate needs.
// Source: vendor/happy/packages/happy-app/sources/sync/typesMessage.ts
//         vendor/happy/packages/happy-app/sources/sync/storageTypes.ts

export type ToolCallState = 'running' | 'completed' | 'error'

export type ToolPermission = {
  id: string
  status: 'pending' | 'approved' | 'denied' | 'canceled'
  reason?: string
  mode?: string
  allowedTools?: string[]
  decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
  date?: number
}

// The view-model the tool-view registry dispatches on. Populated by the
// toolView adapter from trux protocol events (tool_call + tool_result +
// approval_request).
export type ToolCall = {
  name: string
  state: ToolCallState
  input: any
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  description: string | null
  result?: any
  permission?: ToolPermission
}

// Minimal metadata — trux doesn't carry happy's full session metadata, but the
// tool-view registry types reference it. `flavor` is the only field used in
// the rendering dispatch (codex vs claude vs gemini).
export type Metadata = {
  flavor?: string | null
  path?: string
} | null

export type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority?: 'high' | 'medium' | 'low'
  id?: string
}

// Minimal message type for the tool-view registry's `messages` prop.
// trux's flat transcript doesn't carry nested children; the adapter passes [].
export type Message = {
  kind: 'tool-call' | 'agent-text' | 'user-text' | 'agent-event'
  id: string
  tool?: ToolCall
}
