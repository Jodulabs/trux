import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
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

  app.get('/config', async () => ({ tailscaleHost: config.tailscaleHost }))

  // REST routes get their own encapsulated scope so the bearer preHandler hook
  // stays off /health, /config, or the WS upgrade.
  await app.register(async (scope) => {
    registerRoutes(scope, config, registry, manager.availableAgents())
  })
  registerStream(app, config, registry, manager)

  // Serve the built frontend in production. Only registers when dist/ exists so
  // dev mode (Vite proxy) is unaffected.
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../../frontend/dist')
  if (existsSync(distDir)) {
    await app.register(fastifyStatic, { root: distDir, prefix: '/', decorateReply: false })
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'))
  }

  return app
}
