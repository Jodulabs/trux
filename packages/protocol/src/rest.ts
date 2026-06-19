import type { ConversationStatus, ServerEvent } from './events'

export type AgentName = 'claude' | 'codex' | 'opencode'

// One selectable value for a model or a control. `value` is sent to the backend
// verbatim; `label` is shown in the unified UI.
export interface ControlOption {
  value: string
  label: string
}

// A generic, opaque-to-trux knob the backend exposes (effort, reasoning, …).
// trux renders it and passes the chosen value through; it never interprets `key`.
export interface AgentControl {
  key: string
  label: string
  options: ControlOption[]
  default: string // a ControlOption.value, or '' meaning "no override"
}

// A faithful manifest of one backend's native controls. `model` is first-class
// (universal, worth surfacing per conversation); everything else is opaque.
export interface AgentCapabilities {
  agent: AgentName
  models: ControlOption[]
  defaultModel: string | null // null = trux does not pick; backend default applies
  controls: AgentControl[]
}

// Per-turn / per-conversation selection. `options` is keyed by AgentControl.key.
export interface TurnConfig {
  model: string | null // null/'' = no override
  options: Record<string, string>
}

export interface Worktree {
  path: string
  branch: string | null
}
// One project = one git repo. `root` is the repo path, `name` its display label
// (directory basename), and `worktrees` are that repo's own worktrees only —
// never flattened across repos, so the picker can present repo → worktree.
export interface Workspace {
  name: string
  root: string
  worktrees: Worktree[]
}

export interface Conversation {
  id: string
  agent: AgentName
  cwd: string
  title: string | null
  status: ConversationStatus
  native_session_id: string | null
  archived: boolean
  created_at: number
  updated_at: number
  model: string | null
  options: Record<string, string>
}

// One persisted transcript row: a server event with its per-conversation sequence number.
export interface StoredEvent {
  seq: number
  event: ServerEvent
}

export interface CreateConversationRequest {
  agent: AgentName
  cwd: string
  title?: string
  native_session_id?: string
  model?: string | null
  options?: Record<string, string>
}

export interface DiscoveredSession {
  sessionId: string
  updatedAt: number
}

export interface ConversationDetail {
  conversation: Conversation
  transcript: StoredEvent[]
}

export interface AgentsResponse {
  agents: AgentCapabilities[]
}

export interface GitFileStatus {
  path: string
  index: string
  work: string
  staged: boolean
}

export interface GitStatus {
  repo: true
  branch: string | null
  ahead: number
  behind: number
  dirty: boolean
  files: GitFileStatus[]
}

export type GitStatusResult = GitStatus | { repo: false }

export interface CommitResult {
  ok: boolean
  hash?: string
  error?: string
}
