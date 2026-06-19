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
import type { ConnState } from './truxClient'
import { api } from './api'

export type ConvMeta = {
  status: string
  unread: number
  connState: ConnState
  lastSeq: number
}

// A user_text item the client rendered optimistically, before the server echo.
// `pending`/`failed` drive the sending → sent → retry affordance.
export type OptimisticUserText = UserTextEvent & { pending?: boolean; failed?: boolean; client_message_id?: string }

export type TranscriptItem =
  | OptimisticUserText
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent

// Pure reducer: fold a streamed NCP event into the rendered transcript. text_delta
// accumulates into the open text item; the final `text` replaces it. A user_text
// echo reconciles a matching optimistic bubble (by client_message_id) instead of
// appending a duplicate.
export function foldEvent(items: TranscriptItem[], event: ServerEvent): TranscriptItem[] {
  switch (event.type) {
    case 'user_text': {
      if (event.client_message_id) {
        const idx = items.findIndex(
          (it) => it.type === 'user_text' && (it as OptimisticUserText).client_message_id === event.client_message_id,
        )
        if (idx >= 0) {
          const next = items.slice()
          next[idx] = { ...event }
          return next
        }
      }
      return [...items, event]
    }
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
  connState: ConnState
  lastSeq: number
  approvalDecisions: Record<string, ApprovalDecision>
  previewPort: number | null
  tailscaleHost: string | null
  vapidPublicKey: string | null
  // Per-conversation lightweight state for background connections.
  convMeta: Record<string, ConvMeta>
  loadConversations: () => Promise<void>
  loadRemoteConfig: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  applyEvent: (event: ServerEvent) => void
  setConnState: (state: ConnState) => void
  addOptimistic: (item: OptimisticUserText) => void
  failPending: () => string[]
  recordApproval: (requestId: string, decision: ApprovalDecision) => void
  setConvMeta: (id: string, patch: Partial<ConvMeta>) => void
  bumpUnread: (id: string) => void
  clearUnread: (id: string) => void
}

export const useStore = create<TruxState>((set, get) => ({
  conversations: [],
  currentId: null,
  transcript: [],
  status: 'idle',
  connState: 'connecting',
  lastSeq: -1,
  approvalDecisions: {},
  previewPort: null,
  tailscaleHost: null,
  vapidPublicKey: null,
  convMeta: {},
  async loadConversations() {
    set({ conversations: await api.listConversations() })
  },
  async loadRemoteConfig() {
    const cfg = await api.getRemoteConfig()
    set({ tailscaleHost: cfg.tailscaleHost, vapidPublicKey: cfg.vapidPublicKey })
  },
  async selectConversation(id) {
    const detail = await api.getConversation(id)
    const stored = detail.transcript
    const events = stored.map((s) => s.event)
    // Last port_detected in the transcript wins (recovers the preview after reload).
    const lastPort = events.reduce<number | null>(
      (p, e) => (e.type === 'port_detected' ? e.port : p),
      null,
    )
    const lastSeq = stored.reduce<number>((m, s) => (s.seq > m ? s.seq : m), -1)
    // Clear unread for the conversation being opened.
    const prevMeta = get().convMeta[id]
    const newMeta = prevMeta ? { ...prevMeta, unread: 0 } : undefined
    set({
      currentId: id,
      status: detail.conversation.status,
      approvalDecisions: {},
      previewPort: lastPort,
      lastSeq,
      transcript: events.reduce(foldEvent, [] as TranscriptItem[]),
      ...(newMeta ? { convMeta: { ...get().convMeta, [id]: newMeta } } : {}),
    })
  },
  applyEvent(event) {
    // A reconnect delta is just a batch of events — fold them in order.
    if (event.type === 'history_delta') {
      for (const e of event.events) get().applyEvent(e)
      return
    }
    // A snapshot replaces local state: rebuild the transcript from scratch and
    // recover status/port/seq, so a far-behind client converges cleanly.
    if (event.type === 'history_snapshot') {
      const lastPort = event.events.reduce<number | null>(
        (p, e) => (e.type === 'port_detected' ? e.port : p),
        get().previewPort,
      )
      const lastStatus = event.events.reduce<string>(
        (s, e) => (e.type === 'status' ? e.state : s),
        get().status,
      )
      const lastSeq = event.events.reduce<number>(
        (m, e) => (typeof e.seq === 'number' && e.seq > m ? e.seq : m),
        get().lastSeq,
      )
      set({
        transcript: event.events.reduce(foldEvent, [] as TranscriptItem[]),
        previewPort: lastPort,
        status: lastStatus,
        lastSeq,
      })
      return
    }
    if (typeof event.seq === 'number' && event.seq > get().lastSeq) set({ lastSeq: event.seq })
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
  setConnState(state) {
    set({ connState: state })
  },
  addOptimistic(item) {
    set({ transcript: [...get().transcript, item] })
  },
  // Mark every still-pending optimistic bubble failed (e.g. a non-recoverable
  // error arrived with no user_text echo). Returns their ids so the caller can
  // drop them from the durable outbox — otherwise they retry forever.
  failPending() {
    const ids: string[] = []
    set({
      transcript: get().transcript.map((it) => {
        if (it.type === 'user_text' && (it as OptimisticUserText).pending) {
          const o = it as OptimisticUserText
          if (o.client_message_id) ids.push(o.client_message_id)
          return { ...o, pending: false, failed: true }
        }
        return it
      }),
    })
    return ids
  },
  recordApproval(requestId, decision) {
    set({ approvalDecisions: { ...get().approvalDecisions, [requestId]: decision } })
  },
  setConvMeta(id, patch) {
    const prev = get().convMeta[id] ?? { status: 'idle', unread: 0, connState: 'connecting' as ConnState, lastSeq: -1 }
    set({ convMeta: { ...get().convMeta, [id]: { ...prev, ...patch } } })
  },
  bumpUnread(id) {
    const prev = get().convMeta[id] ?? { status: 'idle', unread: 0, connState: 'connecting' as ConnState, lastSeq: -1 }
    set({ convMeta: { ...get().convMeta, [id]: { ...prev, unread: prev.unread + 1 } } })
  },
  clearUnread(id) {
    const prev = get().convMeta[id]
    if (!prev) return
    set({ convMeta: { ...get().convMeta, [id]: { ...prev, unread: 0 } } })
  },
}))
