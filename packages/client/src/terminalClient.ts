import { getServerConfig, getStorage } from './ports'

export interface TerminalHandle {
  onOutput(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
  onError(cb: (message: string) => void): void
  sendInput(data: string): void
  sendResize(cols: number, rows: number): void
  close(): void
}

type WsCtor = new (url: string) => WebSocket

// Opens the terminal channel for a conversation. Token + wsBase come from the
// injected ports (same source as openConnection); WebSocketImpl is injectable for tests.
export function openTerminal(conversationId: string, opts: { WebSocketImpl?: WsCtor } = {}): TerminalHandle {
  const WS = opts.WebSocketImpl ?? (globalThis.WebSocket as unknown as WsCtor)
  const token = getStorage().get('trux_token') ?? null
  const wsBase = getServerConfig().wsBase
  const ws = new WS(`${wsBase}/conversations/${conversationId}/terminal`)

  const outputCbs: ((d: string) => void)[] = []
  const exitCbs: ((code: number) => void)[] = []
  const errorCbs: ((m: string) => void)[] = []

  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }))
  ws.onmessage = (ev: MessageEvent) => {
    let msg: { type?: string; data?: string; code?: number; message?: string }
    try { msg = JSON.parse(String(ev.data)) } catch { return }
    if (msg.type === 'output' && typeof msg.data === 'string') for (const cb of outputCbs) cb(msg.data)
    else if (msg.type === 'exit') for (const cb of exitCbs) cb(msg.code ?? 0)
    else if (msg.type === 'error' && typeof msg.message === 'string') for (const cb of errorCbs) cb(msg.message)
  }

  const sendJSON = (m: unknown): void => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }

  return {
    onOutput: (cb) => outputCbs.push(cb),
    onExit: (cb) => exitCbs.push(cb),
    onError: (cb) => errorCbs.push(cb),
    sendInput: (data) => sendJSON({ type: 'input', data }),
    sendResize: (cols, rows) => sendJSON({ type: 'resize', cols, rows }),
    close: () => ws.close(),
  }
}
