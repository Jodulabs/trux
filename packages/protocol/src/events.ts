// The Normalized Conversation Protocol (NCP). Carried over the WebSocket as JSON.
// This is the single contract the frontend renders and every adapter translates into.

export const PROTOCOL_VERSION = 1 as const

// ---- Shared ----
export type ConversationStatus = 'idle' | 'thinking' | 'awaiting_approval' | 'error'
export type ApprovalDecision = 'allow' | 'deny' | 'allow_always'
export type ToolResultStatus = 'ok' | 'error'

export interface ImageAttachment {
  kind: 'image'
  media_type: string
  data: string // base64
}

// ---- Server -> client (streamed) ----
export interface HelloEvent {
  type: 'hello'
  protocol_version: number
  server: string
}
export interface TurnStartedEvent {
  type: 'turn_started'
  turn_id: string
}
export interface TextDeltaEvent {
  type: 'text_delta'
  turn_id: string
  text: string
}
export interface TextEvent {
  type: 'text'
  turn_id: string
  text: string
}
export interface ToolCallEvent {
  type: 'tool_call'
  turn_id: string
  tool_id: string
  name: string
  input: unknown
}
export interface ToolResultEvent {
  type: 'tool_result'
  turn_id: string
  tool_id: string
  status: ToolResultStatus
  output: string
}
export interface ApprovalRequestEvent {
  type: 'approval_request'
  turn_id: string
  request_id: string
  tool: string
  input: unknown
  explanation?: string
}
export interface StatusEvent {
  type: 'status'
  state: ConversationStatus
}
export interface TurnCompleteEvent {
  type: 'turn_complete'
  turn_id: string
  usage?: { input: number; output: number }
  cost?: number | null
}
export interface ErrorEvent {
  type: 'error'
  message: string
  recoverable: boolean
}
// The persisted echo of a user's prompt, so the transcript renders user turns
// on reload. Emitted by the manager when a user_message arrives (additive, like hello).
export interface UserTextEvent {
  type: 'user_text'
  turn_id: string
  text: string
}

export type ServerEvent =
  | HelloEvent
  | UserTextEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | StatusEvent
  | TurnCompleteEvent
  | ErrorEvent

// ---- Client -> server ----
export interface AuthMessage {
  type: 'auth'
  token: string
}
export interface UserMessageMessage {
  type: 'user_message'
  text: string
  attachments?: ImageAttachment[]
}
export interface ApprovalResponseMessage {
  type: 'approval_response'
  request_id: string
  decision: ApprovalDecision
  note?: string | null
}
export interface InterruptMessage {
  type: 'interrupt'
}

export type ClientMessage =
  | AuthMessage
  | UserMessageMessage
  | ApprovalResponseMessage
  | InterruptMessage
