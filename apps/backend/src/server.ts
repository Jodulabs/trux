import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { Config } from './config'
import type { TruxDatabase } from './db'
import type { SqliteRegistry } from './registry'
import type { ConversationManager } from './manager'
import { registerRoutes } from './routes'
import { registerStream } from './stream'

export async function buildServer(
  config: Config,
  db: TruxDatabase,
  registry: SqliteRegistry,
  manager: ConversationManager,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)

  app.get('/health', async () => {
    const { n } = db.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }
    return { ok: true, conversations: n }
  })

  // REST routes get their own encapsulated scope so the bearer preHandler hook
  // stays off /health and the WS upgrade.
  await app.register(async (scope) => {
    registerRoutes(scope, config, registry, manager.availableAgents())
  })
  registerStream(app, config, registry, manager)

  return app
}
