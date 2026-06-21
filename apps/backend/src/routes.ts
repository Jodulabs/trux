import type { FastifyInstance } from 'fastify'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import type { AgentCapabilities, ConversationDetail, CreateConversationRequest, DiscoveredSession } from '@trux/protocol'
import type { Config } from './config'
import type { SqliteRegistry } from './registry'
import { listWorkspaces } from './workspaces'
import { tokenAccepted } from './auth'
import { gitCommit, gitDiff, gitStage, gitStatus, gitUnstage } from './git'
import { discoverClaudeCommands } from './commands'

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

// Codex stores each session as ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl whose
// first line is a `session_meta` record carrying the session id + cwd. (The old
// `codex session list` CLI subcommand was removed, so we read disk directly — no
// subprocess, no stderr leak.) Walk newest day-folders first, cap the scan.
// `root` is injectable for tests; defaults to the real ~/.codex/sessions.
export function discoverCodexSessions(
  cwd: string,
  root = join(homedir(), '.codex', 'sessions'),
): DiscoveredSession[] {
  if (!existsSync(root)) return []
  const sessions: DiscoveredSession[] = []
  // Descend year → month → day, each sorted desc, so recent sessions come first.
  const descend = (dir: string): string[] => {
    let entries: string[]
    try {
      entries = readdirSync(dir).sort().reverse()
    } catch {
      return []
    }
    return entries.map((e) => join(dir, e))
  }
  const files: string[] = []
  for (const year of descend(root)) {
    for (const month of descend(year)) {
      for (const day of descend(month)) {
        try {
          for (const f of readdirSync(day)) {
            if (f.startsWith('rollout-') && f.endsWith('.jsonl')) files.push(join(day, f))
          }
        } catch {
          // skip unreadable day folder
        }
      }
    }
    if (files.length > 500) break // safety cap on a deep history
  }
  // rollout-<ISO-timestamp>-… filenames sort lexically == chronologically, so a
  // descending sort lets us read newest-first and stop at 10 matches.
  files.sort().reverse()
  for (const file of files) {
    try {
      const firstLine = readFileSync(file, 'utf8').split('\n')[0]
      if (!firstLine) continue
      const parsed = JSON.parse(firstLine) as {
        type?: string
        payload?: { id?: string; cwd?: string }
      }
      if (parsed.type === 'session_meta' && parsed.payload?.cwd === cwd && parsed.payload.id) {
        sessions.push({ sessionId: parsed.payload.id, updatedAt: Math.floor(statSync(file).mtimeMs) })
        if (sessions.length >= 10) break // newest-first, so the first 10 are the most recent
      }
    } catch {
      // skip malformed rollout
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
  agents: AgentCapabilities[],
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

  app.get('/commands/discover', async (req, reply) => {
    const { agent, cwd } = req.query as { agent?: string; cwd?: string }
    if (!agent || !cwd) return reply.code(400).send({ error: 'agent and cwd are required' })
    if (agent === 'claude') return { commands: discoverClaudeCommands(cwd) }
    return { commands: [] }
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
    if (!agents.some((a) => a.agent === body.agent)) {
      return reply.code(400).send({ error: `unknown agent: ${body.agent}` })
    }
    return registry.createConversation({
      agent: body.agent,
      cwd: body.cwd,
      title: body.title,
      native_session_id: body.native_session_id,
      model: body.model ?? null,
      options: body.options ?? {},
    })
  })

  app.get('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conversation = registry.getConversation(id)
    if (!conversation) return reply.code(404).send({ error: 'not found' })
    const detail: ConversationDetail = { conversation, transcript: registry.loadTranscript(id) }
    return detail
  })

  // A browser PushSubscription, stored so the manager can push to this device
  // while the PWA is closed. Body is the JSON the SW's pushManager produced.
  app.post('/push/subscribe', async (req, reply) => {
    const body = req.body as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    const endpoint = body?.endpoint
    const p256dh = body?.keys?.p256dh
    const auth = body?.keys?.auth
    if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
      return reply.code(400).send({ error: 'endpoint and keys.{p256dh,auth} are required' })
    }
    registry.addPushSubscription({ endpoint, p256dh, auth })
    return { ok: true }
  })

  app.post('/push/unsubscribe', async (req, reply) => {
    const body = req.body as { endpoint?: string }
    if (typeof body?.endpoint !== 'string') {
      return reply.code(400).send({ error: 'endpoint is required' })
    }
    registry.removePushSubscription(body.endpoint)
    return { ok: true }
  })

  // --- Git: review & commit the agent's work from the phone. Safe ops only
  // (status / diff / add / restore --staged / commit). No reset/push/rebase/
  // checkout — a fat-finger there is unrecoverable. cwd comes from the conversation.
  const convCwd = (id: string): string | null => registry.getConversation(id)?.cwd ?? null

  app.get('/conversations/:id/git', async (req, reply) => {
    const cwd = convCwd((req.params as { id: string }).id)
    if (!cwd) return reply.code(404).send({ error: 'not found' })
    return gitStatus(cwd)
  })

  app.get('/conversations/:id/git/diff', async (req, reply) => {
    const cwd = convCwd((req.params as { id: string }).id)
    if (!cwd) return reply.code(404).send({ error: 'not found' })
    const { path, staged } = req.query as { path?: string; staged?: string }
    try {
      return { diff: await gitDiff(cwd, { path, staged: staged === '1' || staged === 'true' }) }
    } catch {
      return reply.code(400).send({ error: 'invalid path' })
    }
  })

  app.post('/conversations/:id/git/stage', async (req, reply) => {
    const cwd = convCwd((req.params as { id: string }).id)
    if (!cwd) return reply.code(404).send({ error: 'not found' })
    const { path } = (req.body ?? {}) as { path?: string }
    if (typeof path !== 'string') return reply.code(400).send({ error: 'path is required' })
    try {
      await gitStage(cwd, path)
      return { ok: true }
    } catch {
      return reply.code(400).send({ error: 'invalid path' })
    }
  })

  app.post('/conversations/:id/git/unstage', async (req, reply) => {
    const cwd = convCwd((req.params as { id: string }).id)
    if (!cwd) return reply.code(404).send({ error: 'not found' })
    const { path } = (req.body ?? {}) as { path?: string }
    if (typeof path !== 'string') return reply.code(400).send({ error: 'path is required' })
    try {
      await gitUnstage(cwd, path)
      return { ok: true }
    } catch {
      return reply.code(400).send({ error: 'invalid path' })
    }
  })

  app.post('/conversations/:id/git/commit', async (req, reply) => {
    const cwd = convCwd((req.params as { id: string }).id)
    if (!cwd) return reply.code(404).send({ error: 'not found' })
    const { message } = (req.body ?? {}) as { message?: string }
    if (typeof message !== 'string') return reply.code(400).send({ error: 'message is required' })
    return gitCommit(cwd, message)
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
