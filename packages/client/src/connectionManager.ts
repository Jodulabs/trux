import type { ServerEvent } from '@trux/protocol'
import { connectTrux, type ConnState, type TruxClient } from './truxClient'
import { useStore } from './store'
import { dequeue, enqueue, loadQueue } from './outbox'
import { getServerConfig, getStorage } from './ports'

// Module-level map: one TruxClient per conversation, kept alive across switches.
const connections = new Map<string, TruxClient>()

// Active-conversation callbacks: set by ConversationView on mount, cleared on unmount.
// Only one conversation can be "active" (rendering its full transcript) at a time.
type ActiveHandlers = {
  id: string
  onEvent: (event: ServerEvent) => void
  onConnState: (state: ConnState) => void
}
let activeHandlers: ActiveHandlers | null = null

export function setActiveHandlers(h: ActiveHandlers): void {
  activeHandlers = h
}

export function clearActiveHandlers(): void {
  activeHandlers = null
}

export function getConnection(id: string): TruxClient | undefined {
  return connections.get(id)
}

// Open a persistent connection for `id`. No-op if already open. Token + WS base
// come from the injected ports so callers don't need to pass them explicitly.
export function openConnection(id: string): void {
  if (connections.has(id)) return
  const token = getStorage().get('trux_token') ?? ''
  const wsBase = getServerConfig().wsBase
  const client = connectTrux({
    url: `${wsBase}/conversations/${id}/stream`,
    token,
    resumeSeq: () => useStore.getState().convMeta[id]?.lastSeq ?? -1,
    onConnState(state) {
      useStore.getState().setConvMeta(id, { connState: state })
      if (state === 'connected') {
        for (const m of loadQueue(id)) client.sendUserMessage(m.text, m.attachments, m.client_message_id, m.config)
      }
      if (activeHandlers?.id === id) activeHandlers.onConnState(state)
    },
    onEvent(event) {
      const store = useStore.getState()
      // Update per-conversation meta.
      if (event.type === 'status') store.setConvMeta(id, { status: event.state })
      if (typeof event.seq === 'number') {
        const cur = store.convMeta[id]?.lastSeq ?? -1
        if (event.seq > cur) store.setConvMeta(id, { lastSeq: event.seq })
      }
      // Accumulate cost from turn_complete events.
      if (event.type === 'turn_complete' && event.cost) {
        const prev = store.convMeta[id]?.totalCost ?? 0
        store.setConvMeta(id, { totalCost: prev + event.cost })
      }
      // Bump unread for background conversations on significant events.
      if (id !== store.currentId) {
        if (event.type === 'turn_complete' || event.type === 'approval_request') {
          store.bumpUnread(id)
        }
      }
      // Dequeue outbox entries when the server echoes a user message.
      if (event.type === 'user_text' && event.client_message_id) dequeue(id, event.client_message_id)
      if (event.type === 'history_delta' || event.type === 'history_snapshot') {
        for (const e of event.events) {
          if (e.type === 'user_text' && e.client_message_id) dequeue(id, e.client_message_id)
        }
      }
      // Route to the active-conversation handlers (transcript, haptics, etc.).
      if (activeHandlers?.id === id) activeHandlers.onEvent(event)
    },
  })
  connections.set(id, client)
}

export { enqueue }
