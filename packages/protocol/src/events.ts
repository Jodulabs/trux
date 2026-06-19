// The Normalized Conversation Protocol (NCP). Carried over the WebSocket as JSON.
// This is the single contract the frontend renders and every adapter translates into.

export const PROTOCOL_VERSION = 1 as const

// ---- Shared ----
export type ConversationStatus = 'idle' | 'thinking' | 'awaiting_approval' | 'error'
// Graduated trust scopes. `allow`/`deny` are one-shot. `allow_always` accepts the
// SDK's suggested permission rule. `allow_edits` flips Edit/Write/MultiEdit to
// auto-approve for the rest of the session; `allow_command` pins this exact Bash
// command so future identical invocations auto-approve — the middle ground between
// babysitting every call and full yolo.
export type ApprovalDecision = 'allow' | 'deny' | 'allow_always' | 'allow_edits' | 'allow_command'
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
  images?: ImageAttachment[]
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
// client_message_id echoes the sender's optimistic id so the client can reconcile
// its locally-rendered bubble instead of duplicating it.
export interface UserTextEvent {
  type: 'user_text'
  turn_id: string
  text: string
  attachments?: ImageAttachment[]
  client_message_id?: string
}
// The detected dev-server port for a conversation (Mode A "Open preview").
export interface PortDetectedEvent {
  type: 'port_detected'
  port: number
}
// Sent once after a resume to replay events the client missed while disconnected.
export interface HistoryDeltaEvent {
  type: 'history_delta'
  events: ServerEvent[]
}
// Sent instead of a delta when the client is too far behind: the full transcript,
// which the client folds from scratch (replacing its current items).
export interface HistorySnapshotEvent {
  type: 'history_snapshot'
  events: ServerEvent[]
}

// Every persisted server event carries an optional per-conversation seq once it
// has been stored (text_delta stays unsequenced — it's broadcast-only). The
// intersection distributes `seq?` across each member while keeping `type`
// narrowing intact (A & (B | C) === (A & B) | (A & C)).
export type ServerEvent = { seq?: number } & (
  | HelloEvent
  | UserTextEvent
  | PortDetectedEvent
  | HistoryDeltaEvent
  | HistorySnapshotEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | StatusEvent
  | TurnCompleteEvent
  | ErrorEvent
)

// ---- Client -> server ----
export interface AuthMessage {
  type: 'auth'
  token: string
}
export interface UserMessageMessage {
  type: 'user_message'
  text: string
  attachments?: ImageAttachment[]
  // Optimistic id the client assigns so it can reconcile its locally-rendered
  // bubble with the server's user_text echo, and dedupe a re-sent queued message.
  client_message_id?: string
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
// Sent right after auth on a reconnect: replay everything with seq > since_seq.
export interface ResumeMessage {
  type: 'resume'
  since_seq: number
}

export type ClientMessage =
  | AuthMessage
  | UserMessageMessage
  | ApprovalResponseMessage
  | InterruptMessage
  | ResumeMessage
