import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { parseClientMessage, PROTOCOL_VERSION, type ServerEvent } from '@trux/protocol'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import type { ConversationManager } from './manager'
import { tokenAccepted } from './auth'

function send(socket: WebSocket, event: ServerEvent): void {
  socket.send(JSON.stringify(event))
}

export function registerStream(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
  manager: ConversationManager,
): void {
  app.register(async (scope) => {
    scope.get('/conversations/:id/stream', { websocket: true }, (socket, req) => {
      const { id } = req.params as { id: string }
      let authed = false
      let detach: (() => void) | null = null

      socket.on('close', () => detach?.())

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
          if (!tokenAccepted(config, msg.token)) {
            send(socket, { type: 'error', message: 'unauthorized', recoverable: false })
            socket.close()
            return
          }
          if (!registry.getConversation(id)) {
            send(socket, { type: 'error', message: 'unknown conversation', recoverable: false })
            socket.close()
            return
          }
          authed = true
          send(socket, { type: 'hello', protocol_version: PROTOCOL_VERSION, server: 'trux' })
          // Attach to live events for this conversation (history is restored via REST).
          detach = manager.attach(id, (event) => send(socket, event))
          return
        }

        if (msg.type === 'user_message') {
          void manager.handleUserMessage(id, msg.text, msg.attachments, msg.client_message_id, msg.config)
        } else if (msg.type === 'interrupt') {
          void manager.interrupt(id)
        } else if (msg.type === 'approval_response') {
          void manager.handleApprovalResponse(id, msg.request_id, msg.decision, msg.note ?? null)
        } else if (msg.type === 'resume') {
          // Reconnect: replay only what this socket missed, to this socket alone.
          manager.replaySince(id, msg.since_seq, (event) => send(socket, event))
        }
      })
    })
  })
}
