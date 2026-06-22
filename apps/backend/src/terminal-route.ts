import type { FastifyInstance } from 'fastify'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import { tokenAccepted } from './auth'
import { TerminalSession, type TerminalLike, type TerminalClientMsg, type TerminalServerMsg } from './terminal'

// Minimal socket surface so the handler is unit-testable without a real WS.
// The real @fastify/websocket socket is cast to this (see registerTerminal).
export interface SocketLike {
  send(data: string): void
  close(): void
  on(event: 'message' | 'close', cb: (raw: Buffer) => void): void
}

export interface TerminalDeps {
  config: Config
  cwdForConversation: (id: string) => string | null
  makeSession: (cwd: string) => TerminalLike
}

function parse(raw: string): TerminalClientMsg | null {
  try {
    const m = JSON.parse(raw) as TerminalClientMsg
    if (m && typeof (m as { type?: unknown }).type === 'string') return m
  } catch { /* fall through */ }
  return null
}

// Auth-as-first-message, mirroring stream.ts. Spawns the PTY only after a valid
// token + a known conversation; kills it when the socket closes.
export function wireTerminalSocket(socket: SocketLike, id: string, deps: TerminalDeps): void {
  const send = (msg: TerminalServerMsg): void => socket.send(JSON.stringify(msg))
  let session: TerminalLike | null = null
  let authed = false

  socket.on('close', () => session?.kill())

  socket.on('message', (raw: Buffer) => {
    const msg = parse(raw.toString())
    if (!msg) { send({ type: 'error', message: 'invalid message' }); return }

    if (!authed) {
      if (msg.type !== 'auth') { send({ type: 'error', message: 'auth required as first message' }); socket.close(); return }
      if (!tokenAccepted(deps.config, msg.token)) { send({ type: 'error', message: 'unauthorized' }); socket.close(); return }
      const cwd = deps.cwdForConversation(id)
      if (!cwd) { send({ type: 'error', message: 'unknown conversation' }); socket.close(); return }
      authed = true
      session = deps.makeSession(cwd)
      session.onData((data) => send({ type: 'output', data }))
      session.onExit((code) => { send({ type: 'exit', code }); socket.close() })
      send({ type: 'ready' })
      return
    }

    if (msg.type === 'input') session?.write(msg.data)
    else if (msg.type === 'resize') session?.resize(msg.cols, msg.rows)
  })
}

export function registerTerminal(app: FastifyInstance, config: Config, registry: SqliteRegistry): void {
  app.register(async (scope) => {
    scope.get('/conversations/:id/terminal', { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string }
      wireTerminalSocket(socket as unknown as SocketLike, id, {
        config,
        cwdForConversation: (cid) => registry.getConversation(cid)?.cwd ?? null,
        makeSession: (cwd) => new TerminalSession(cwd),
      })
    })
  })
}
