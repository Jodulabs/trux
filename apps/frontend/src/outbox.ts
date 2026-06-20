import type { ImageAttachment, TurnConfig } from '@trux/protocol'

// A prompt the user sent while the socket was down. Persisted to localStorage so
// it survives an app kill, deduped by client_message_id, flushed in order on
// reconnect. Keyed per conversation.
export interface QueuedMessage {
  client_message_id: string
  text: string
  attachments?: ImageAttachment[]
  config?: TurnConfig
}

const KEY = (convId: string): string => `trux_outbox_${convId}`

export function loadQueue(convId: string): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(KEY(convId))
    return raw ? (JSON.parse(raw) as QueuedMessage[]) : []
  } catch {
    return []
  }
}

function saveQueue(convId: string, q: QueuedMessage[]): void {
  try {
    if (q.length === 0) localStorage.removeItem(KEY(convId))
    else localStorage.setItem(KEY(convId), JSON.stringify(q))
  } catch {
    // storage full / unavailable — best-effort
  }
}

export function enqueue(convId: string, msg: QueuedMessage): void {
  const q = loadQueue(convId)
  if (q.some((m) => m.client_message_id === msg.client_message_id)) return
  q.push(msg)
  saveQueue(convId, q)
}

export function dequeue(convId: string, clientMessageId: string): void {
  saveQueue(
    convId,
    loadQueue(convId).filter((m) => m.client_message_id !== clientMessageId),
  )
}

export function newMessageId(): string {
  // crypto.randomUUID exists in all PWA-capable browsers; fall back just in case.
  try {
    return crypto.randomUUID()
  } catch {
    return `m_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
  }
}
