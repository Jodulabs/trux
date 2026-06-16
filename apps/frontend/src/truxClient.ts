import type { ClientMessage, HelloEvent, ServerEvent } from '@trux/protocol'

export interface TruxClientOptions {
  url: string
  token?: string
  onEvent?: (event: ServerEvent) => void
  onReady?: (hello: HelloEvent) => void
  WebSocketImpl?: typeof WebSocket
}

export interface TruxClient {
  send: (msg: ClientMessage) => void
  sendUserMessage: (text: string) => void
  interrupt: () => void
  close: () => void
}

// Open the WS, authenticate on connect, and surface normalized events.
export function connectTrux(opts: TruxClientOptions): TruxClient {
  const WS = opts.WebSocketImpl ?? WebSocket
  const ws = new WS(opts.url)

  ws.addEventListener('open', () => {
    const auth: ClientMessage = { type: 'auth', token: opts.token ?? '' }
    ws.send(JSON.stringify(auth))
  })

  ws.addEventListener('message', (ev: MessageEvent) => {
    let event: ServerEvent
    try {
      event = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as ServerEvent
    } catch {
      return
    }
    if (event.type === 'hello') opts.onReady?.(event)
    opts.onEvent?.(event)
  })

  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    sendUserMessage: (text) => ws.send(JSON.stringify({ type: 'user_message', text })),
    interrupt: () => ws.send(JSON.stringify({ type: 'interrupt' })),
    close: () => ws.close(),
  }
}
