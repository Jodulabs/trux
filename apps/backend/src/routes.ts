import type { FastifyInstance } from 'fastify'
import type { ConversationDetail, CreateConversationRequest } from '@trux/protocol'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import { listWorkspaces } from './workspaces'
import { tokenAccepted } from './auth'

export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
): void {
  // Bearer gate for REST (no-op locally when authRequired is false). Scoped to
  // this plugin so it never runs for /health or the WS upgrade (registered elsewhere).
  app.addHook('preHandler', async (req, reply) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
    if (!tokenAccepted(config, token)) {
      await reply.code(401).send({ error: 'unauthorized' })
    }
  })

  app.get('/workspaces', async () => listWorkspaces(config.workspaceRoots))

  app.get('/conversations', async () => registry.listConversations())

  app.post('/conversations', async (req, reply) => {
    const body = req.body as CreateConversationRequest
    if (!body || body.agent !== 'claude' || typeof body.cwd !== 'string' || body.cwd.length === 0) {
      return reply.code(400).send({ error: 'agent must be "claude" and cwd is required' })
    }
    return registry.createConversation({ agent: 'claude', cwd: body.cwd, title: body.title })
  })

  app.get('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conversation = registry.getConversation(id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    const detail: ConversationDetail = { conversation, transcript: registry.loadTranscript(id) }
    return detail
  })

  app.patch('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as { archived?: boolean }
    if (body.archived === true) registry.archiveConversation(id)
    const conversation = registry.getConversation(id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    return conversation
  })
}
