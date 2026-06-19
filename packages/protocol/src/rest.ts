import type { ConversationStatus, ServerEvent } from './events'

export type AgentName = 'claude' | 'codex' | 'opencode'

export interface Worktree {
  path: string
  branch: string | null
}
export interface Workspace {
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
  agents: AgentName[]
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
