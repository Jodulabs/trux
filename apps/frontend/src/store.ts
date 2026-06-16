import { create } from 'zustand'
import type {
  Conversation,
  ServerEvent,
  TextEvent,
  ToolCallEvent,
  ToolResultEvent,
  UserTextEvent,
} from '@trux/protocol'
import { api } from './api'

export type TranscriptItem = UserTextEvent | TextEvent | ToolCallEvent | ToolResultEvent

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
    default:
      return items
  }
}

interface TruxState {
  conversations: Conversation[]
  currentId: string | null
  transcript: TranscriptItem[]
  status: string
  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  applyEvent: (event: ServerEvent) => void
}

export const useStore = create<TruxState>((set, get) => ({
  conversations: [],
  currentId: null,
  transcript: [],
  status: 'idle',
  async loadConversations() {
    set({ conversations: await api.listConversations() })
  },
  async selectConversation(id) {
    const detail = await api.getConversation(id)
    set({
      currentId: id,
      status: detail.conversation.status,
      transcript: detail.transcript.map((s) => s.event).reduce(foldEvent, [] as TranscriptItem[]),
    })
  },
  applyEvent(event) {
    if (event.type === 'status') {
      set({ status: event.state })
      return
    }
    set({ transcript: foldEvent(get().transcript, event) })
  },
}))
