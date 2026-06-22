import type { FastifyInstance } from 'fastify'
import type { Config } from './config'
import type { Authenticator } from './auth-provider'

// Registered INSIDE the bearer-gated REST scope (server.ts) — the preHandler in
// registerRoutes already rejects unauthorized requests, so no extra auth here.
// `config` is unused today but kept in the signature to match the route family
// and for Phase 2 (per-provider policy).
export function registerAuth(
  app: FastifyInstance,
  _config: Config,
  authenticators: Map<string, Authenticator>,
): void {
  const find = (id: string): Authenticator | undefined => authenticators.get(id)

  app.get('/auth/providers', async () =>
    [...authenticators.values()].map((a) => ({ id: a.id, plane: a.plane })),
  )

  app.post('/auth/:provider/begin', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    return a.begin()
  })

  app.get('/auth/:provider/poll', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    return { status: await a.poll() }
  })

  app.get('/auth/:provider/status', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    return { status: await a.status() }
  })

  app.post('/auth/:provider/disconnect', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    await a.disconnect()
    return { status: 'disconnected' as const }
  })

  app.post('/auth/:provider/key', async (req, reply) => {
    const a = find((req.params as { provider: string }).provider)
    if (!a) return reply.code(400).send({ error: 'unknown provider' })
    if (!a.submitKey) return reply.code(400).send({ error: 'provider has no key fallback' })
    const body = req.body as { key?: string }
    if (!body || typeof body.key !== 'string' || body.key.length === 0) {
      return reply.code(400).send({ error: 'key is required' })
    }
    return { status: await a.submitKey(body.key) }
  })
}
