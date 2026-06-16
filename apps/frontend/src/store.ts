import { create } from 'zustand'
import type {
  ApprovalDecision,
  ApprovalRequestEvent,
  Conversation,
  ServerEvent,
  TextEvent,
  ToolCallEvent,
  ToolResultEvent,
  UserTextEvent,
} from '@trux/protocol'
import { api } from './api'

export type TranscriptItem =
  | UserTextEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent

// Pure reducer: fold a streamed NCP event into the rendered transcript. text_delta
// accumulates into the open text item; the final `text` replaces it.
export function foldEvent(items: TranscriptItem[], event: ServerEvent): TranscriptItem[] {
  switch (event.type) {
    case 'user_text':
      return [...items, event]
    case 'text_delta': {
      const last = items[items.length - 1]
      if (last && last.type === 'text' && last.turn_id === event.turn_id) {
        return [...items.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return [...items, { type: 'text', turn_id: event.turn_id, text: event.text }]
    }
    case 'text': {
      const last = items[items.length - 1]
      if (last && last.type === 'text' && last.turn_id === event.turn_id) {
        return [...items.slice(0, -1), { type: 'text', turn_id: event.turn_id, text: event.text }]
      }
      return [...items, event]
    }
    case 'tool_call':
      return [...items, event]
    case 'tool_result':
      return [...items, event]
    case 'approval_request':
      return [...items, event]
    default:
      return items
  }
}

interface TruxState {
  conversations: Conversation[]
  currentId: string | null
  transcript: TranscriptItem[]
  status: string
  approvalDecisions: Record<string, ApprovalDecision>
  previewPort: number | null
  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  applyEvent: (event: ServerEvent) => void
  recordApproval: (requestId: string, decision: ApprovalDecision) => void
}

export const useStore = create<TruxState>((set, get) => ({
  conversations: [],
  currentId: null,
  transcript: [],
  status: 'idle',
  approvalDecisions: {},
  previewPort: null,
  async loadConversations() {
    set({ conversations: await api.listConversations() })
  },
  async selectConversation(id) {
    const detail = await api.getConversation(id)
    const events = detail.transcript.map((s) => s.event)
    // Last port_detected in the transcript wins (recovers the preview after reload).
    const lastPort = events.reduce<number | null>(
      (p, e) => (e.type === 'port_detected' ? e.port : p),
      null,
    )
    set({
      currentId: id,
      status: detail.conversation.status,
      approvalDecisions: {},
      previewPort: lastPort,
      transcript: events.reduce(foldEvent, [] as TranscriptItem[]),
    })
  },
  applyEvent(event) {
    if (event.type === 'status') {
      set({ status: event.state })
      return
    }
    if (event.type === 'port_detected') {
      set({ previewPort: event.port })
      return
    }
    set({ transcript: foldEvent(get().transcript, event) })
  },
  recordApproval(requestId, decision) {
    set({ approvalDecisions: { ...get().approvalDecisions, [requestId]: decision } })
  },
}))
