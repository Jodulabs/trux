import type { ApprovalDecision, ClientMessage, HelloEvent, ImageAttachment, ServerEvent } from '@trux/protocol'

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface TruxClientOptions {
  url: string
  token?: string
  onEvent?: (event: ServerEvent) => void
  onReady?: (hello: HelloEvent) => void
  onConnState?: (state: ConnState) => void
  // The seq the client has already seen, asked for on (re)connect so the server
  // can replay only what was missed. Read fresh each connect (Phase 3 wires it).
  resumeSeq?: () => number | null
  WebSocketImpl?: typeof WebSocket
}

export interface TruxClient {
  send: (msg: ClientMessage) => void
  sendUserMessage: (text: string, attachments?: ImageAttachment[], clientMessageId?: string) => void
  interrupt: () => void
  respondApproval: (requestId: string, decision: ApprovalDecision, note?: string | null) => void
  close: () => void
}

// Backoff schedule for reconnects (ms). A phone sleeping mid-turn drops the
// socket; without this the conversation silently dies. Caps at 30s.
const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000]

// Open the WS, authenticate on connect, surface normalized events, and survive
// disconnects: reconnect with capped backoff. A monotonic connection epoch fences
// off a dead socket's late callbacks so they can't corrupt the live connection.
export function connectTrux(opts: TruxClientOptions): TruxClient {
  const WS = opts.WebSocketImpl ?? WebSocket
  let ws: WebSocket
  let epoch = 0
  let attempt = 0
  let closedByUser = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const setState = (s: ConnState): void => opts.onConnState?.(s)

  const connect = (): void => {
    const myEpoch = ++epoch
    const fresh = myEpoch === 1
    setState(fresh ? 'connecting' : 'reconnecting')
    ws = new WS(opts.url)

    ws.addEventListener('open', () => {
      if (myEpoch !== epoch) return
      attempt = 0
      const auth: ClientMessage = { type: 'auth', token: opts.token ?? '' }
      ws.send(JSON.stringify(auth))
      // After re-auth, ask for anything missed (no-op until the server speaks seq).
      const since = opts.resumeSeq?.()
      if (since != null && since >= 0) ws.send(JSON.stringify({ type: 'resume', since_seq: since }))
    })

    ws.addEventListener('message', (ev: MessageEvent) => {
      if (myEpoch !== epoch) return
      let event: ServerEvent
      try {
        event = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerEvent
      } catch {
        return
      }
      if (event.type === 'hello') {
        setState('connected')
        opts.onReady?.(event)
      }
      opts.onEvent?.(event)
    })

    const onDown = (): void => {
      if (myEpoch !== epoch || closedByUser) return
      scheduleReconnect()
    }
    ws.addEventListener('close', onDown)
    ws.addEventListener('error', onDown)
  }

  const scheduleReconnect = (): void => {
    if (closedByUser || reconnectTimer) return
    setState('offline')
    const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)]
    attempt++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  connect()

  const safeSend = (data: string): void => {
    try {
      ws.send(data)
    } catch {
      // socket not open — Phase 3's offline queue covers durable delivery
    }
  }

  return {
    send: (msg) => safeSend(JSON.stringify(msg)),
    sendUserMessage: (text, attachments, clientMessageId) =>
      safeSend(
        JSON.stringify({
          type: 'user_message',
          text,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
        }),
      ),
    interrupt: () => safeSend(JSON.stringify({ type: 'interrupt' })),
    respondApproval: (requestId, decision, note = null) =>
      safeSend(JSON.stringify({ type: 'approval_response', request_id: requestId, decision, note })),
    close: () => {
      closedByUser = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      epoch++ // fence any in-flight callbacks
      ws.close()
    },
  }
}
