import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { AgentName, ConversationDetail, CreateConversationRequest, DiscoveredSession } from '@trux/protocol'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import { listWorkspaces } from './workspaces'
import { tokenAccepted } from './auth'

// Convert an absolute cwd to the Claude project folder name.
// e.g. /home/gp/foo → -home-gp-foo  (leading slash → hyphen, each subsequent / → -)
export function cwdToClaudeFolder(cwd: string): string {
  return cwd.replace(/\//g, '-')
}

function discoverClaudeSessions(cwd: string): DiscoveredSession[] {
  const folder = cwdToClaudeFolder(cwd)
  const projectDir = join(homedir(), '.claude', 'projects', folder)
  if (!existsSync(projectDir)) return []
  let files: string[]
  try {
    files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const sessions: DiscoveredSession[] = []
  for (const file of files) {
    try {
      const firstLine = readFileSync(join(projectDir, file), 'utf8').split('\n')[0]
      if (!firstLine) continue
      const parsed = JSON.parse(firstLine) as { type?: string; sessionId?: string }
      if (parsed.type === 'last-prompt' && parsed.sessionId) {
        const stat = require('node:fs').statSync(join(projectDir, file)) as { mtimeMs: number }
        sessions.push({ sessionId: parsed.sessionId, updatedAt: Math.floor(stat.mtimeMs) })
      }
    } catch {
      // skip malformed files
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10)
}

function discoverCodexSessions(cwd: string): DiscoveredSession[] {
  try {
    const out = execFileSync('codex', ['session', 'list', '--json'], { timeout: 5000, encoding: 'utf8' })
    const rows = JSON.parse(out) as Array<{ id?: string; cwd?: string; updatedAt?: number; updated_at?: number }>
    return rows
      .filter((r) => r.cwd === cwd && r.id)
      .map((r) => ({ sessionId: r.id!, updatedAt: r.updatedAt ?? r.updated_at ?? 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
  } catch {
    return []
  }
}

export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
  agents: AgentName[],
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

  app.get('/agents', async () => ({ agents }))

  app.get('/sessions/discover', async (req, reply) => {
    const { agent, cwd } = req.query as { agent?: string; cwd?: string }
    if (!agent || !cwd) return reply.code(400).send({ error: 'agent and cwd are required' })
    if (agent === 'claude') return discoverClaudeSessions(cwd)
    if (agent === 'codex') return discoverCodexSessions(cwd)
    return reply.code(400).send({ error: `session discovery not supported for agent: ${agent}` })
  })

  app.get('/conversations', async () => registry.listConversations())

  app.get('/conversations/search', async (req, reply) => {
    const { q } = req.query as { q?: string }
    if (!q || q.trim().length === 0) return reply.code(400).send({ error: 'q is required' })
    return registry.searchConversations(q.trim())
  })

  app.post('/conversations', async (req, reply) => {
    const body = req.body as CreateConversationRequest
    if (!body || typeof body.cwd !== 'string' || body.cwd.length === 0) {
      return reply.code(400).send({ error: 'cwd is required' })
    }
    if (!agents.includes(body.agent)) {
      return reply.code(400).send({ error: `unknown agent: ${body.agent}` })
    }
    return registry.createConversation({
      agent: body.agent,
      cwd: body.cwd,
      title: body.title,
      native_session_id: body.native_session_id,
    })
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
    const body = (req.body ?? {}) as { archived?: boolean; title?: string }
    if (body.archived === true) registry.archiveConversation(id)
    if (typeof body.title === 'string' && body.title.length > 0) registry.renameConversation(id, body.title)
    const conversation = registry.getConversation(id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    return conversation
  })
}
