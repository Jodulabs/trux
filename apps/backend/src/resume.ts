import { createInterface } from 'node:readline'
import { spawn } from 'node:child_process'
import type { AgentName, Conversation } from '@trux/protocol'
import { loadEnvFiles } from './banner'
import { loadConfig } from './config'
import { openDb } from './db'
import { SqliteRegistry } from './registry'

export function buildHandoffCommand(agent: AgentName, nativeSessionId: string): string[] | null {
  switch (agent) {
    case 'claude':
      return ['claude', '--resume', nativeSessionId]
    case 'codex':
      return ['codex', 'resume', nativeSessionId]
    case 'pi':
      return ['pi', '--session', nativeSessionId]
    default:
      return null
  }
}

export function filterConversations(conversations: Conversation[], query: string): Conversation[] {
  const q = query.trim().toLowerCase()
  if (!q) return conversations
  return conversations.filter(
    (c) =>
      (c.title?.toLowerCase().includes(q) ?? false) ||
      c.cwd.toLowerCase().includes(q) ||
      c.agent.toLowerCase().includes(q),
  )
}

/** Interactive handoff picker. Returns a process exit code. */
export async function runResume(args: string[]): Promise<number> {
  loadEnvFiles()
  const config = loadConfig()
  const db = openDb(config.dbPath)
  const registry = new SqliteRegistry(db)

  const query = args[0] ?? ''
  const all = registry.listConversations().filter((c) => !c.archived)
  const conversations = filterConversations(all, query)

  if (conversations.length === 0) {
    console.log('No conversations found.')
    return 1
  }

  conversations.forEach((c, i) => {
    const title = c.title ?? c.cwd
    const statusMark = c.status === 'idle' ? '' : ` [${c.status}]`
    console.log(`${i + 1}. ${title} (${c.agent})${statusMark}`)
  })

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => {
    rl.question('Select a conversation (number): ', resolve)
  })
  const idx = parseInt(answer, 10) - 1
  if (Number.isNaN(idx) || idx < 0 || idx >= conversations.length) {
    console.log('Invalid selection.')
    rl.close()
    return 1
  }
  const conv = conversations[idx]
  if (conv.status !== 'idle') {
    console.log(`Conversation is ${conv.status}. Handoff only allowed when idle.`)
    rl.close()
    return 1
  }
  if (!conv.native_session_id) {
    console.log('Conversation has no native session id yet.')
    rl.close()
    return 1
  }
  const command = buildHandoffCommand(conv.agent, conv.native_session_id)
  if (!command) {
    console.log(`Handoff not supported for agent: ${conv.agent}`)
    rl.close()
    return 1
  }
  rl.close()
  console.log(`\n→ cd ${conv.cwd} && ${command.join(' ')}\n`)
  const proc = spawn(command[0], command.slice(1), {
    cwd: conv.cwd,
    stdio: 'inherit',
    env: process.env as Record<string, string>,
  })
  return new Promise<number>((resolve) => {
    proc.on('exit', (code) => resolve(code ?? 0))
    proc.on('error', (err) => {
      console.error(`Failed to start ${command[0]}:`, err.message)
      resolve(1)
    })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runResume(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
