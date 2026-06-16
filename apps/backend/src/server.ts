import { timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import { parseClientMessage, PROTOCOL_VERSION, type ServerEvent } from '@trux/protocol'
import type { Config } from './config'
import type { TruxDatabase } from './db'

function send(socket: WebSocket, event: ServerEvent): void {
  socket.send(JSON.stringify(event))
}

// Constant-time secret compare — the auth boundary is the RCE boundary (see design: Auth & security).
function tokenMatches(secret: string, token: string): boolean {
  const a = Buffer.from(secret)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function buildServer(config: Config, db: TruxDatabase): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)

  app.get('/health', async () => {
    const { n } = db.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }
    return { ok: true, conversations: n }
  })

  await app.register(async (scope) => {
    scope.get('/conversations/:id/stream', { websocket: true }, (socket) => {
      let authed = false
      // Handlers must be attached synchronously (per @fastify/websocket docs).
      socket.on('message', (raw: Buffer) => {
        const msg = parseClientMessage(raw.toString())
        if (!msg) {
          send(socket, { type: 'error', message: 'invalid message', recoverable: true })
          return
        }

        if (!authed) {
          if (msg.type !== 'auth') {
            send(socket, { type: 'error', message: 'auth required as first message', recoverable: false })
            socket.close()
            return
          }
          const ok = config.authRequired
            ? config.secret !== null && tokenMatches(config.secret, msg.token)
            : true
          if (!ok) {
            send(socket, { type: 'error', message: 'unauthorized', recoverable: false })
            socket.close()
            return
          }
          authed = true
          send(socket, { type: 'hello', protocol_version: PROTOCOL_VERSION, server: 'trux' })
          return
        }

        // Authed but past hello: Phase 0 has no turn engine yet (Phase 1 wires the adapter).
        send(socket, { type: 'error', message: 'not implemented in phase 0', recoverable: true })
      })
    })
  })

  return app
}
