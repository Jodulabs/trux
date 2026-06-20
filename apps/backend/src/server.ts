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
  opts?: { vapidPublicKey?: string | null },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(websocket)

  app.get('/health', async () => {
    const { n } = db.prepare('SELECT count(*) AS n FROM conversations').get() as { n: number }
    return { ok: true, conversations: n }
  })

  app.get('/config', async () => ({
    tailscaleHost: config.tailscaleHost,
    // null when push is disabled (no VAPID keys) → the client skips subscribing.
    vapidPublicKey: opts?.vapidPublicKey ?? null,
  }))

  // REST routes get their own encapsulated scope so the bearer preHandler hook
  // stays off /health, /config, or the WS upgrade.
  await app.register(async (scope) => {
    registerRoutes(scope, config, registry, manager.capabilities())
  })
  registerStream(app, config, registry, manager)

  // Serve the built frontend in production. Only registers when dist/ exists so
  // dev mode (Vite proxy) is unaffected. Path is relative to apps/backend/src (or
  // apps/backend/dist if compiled) → apps/frontend/dist either way.
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
  if (existsSync(distDir)) {
    // decorateReply must stay on: the SPA fallback below calls reply.sendFile.
    await app.register(fastifyStatic, { root: distDir, prefix: '/' })
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'))
    console.log(`trux: serving frontend from ${distDir}`)
  } else {
    console.log(`trux: no frontend build at ${distDir} (dev mode, or run: pnpm --filter frontend build)`)
  }

  return app
}
