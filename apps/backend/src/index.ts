import 'dotenv/config'
import type { AgentName } from '@trux/protocol'
import { loadConfig, assertConfig } from './config'
import { openDb } from './db'
import { SqliteRegistry } from './registry'
import { ClaudeAdapter } from './adapter/claude'
import { CodexAdapter } from './adapter/codex'
import { OpencodeAdapter } from './adapter/opencode'
import { ConversationManager } from './manager'
import type { AgentAdapter } from './adapter/types'
import { buildServer } from './server'

async function main(): Promise<void> {
  const config = loadConfig()
  assertConfig(config)
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`invalid TRUX_PORT: ${process.env.TRUX_PORT}`)
  }
  const db = openDb(config.dbPath)
  const registry = new SqliteRegistry(db)
  const adapters = new Map<AgentName, AgentAdapter>([
    ['claude', new ClaudeAdapter()],
    ['codex', new CodexAdapter()],
    ['opencode', new OpencodeAdapter()],
  ])
  const manager = new ConversationManager(registry, adapters)
  const app = await buildServer(config, db, registry, manager)
  await app.listen({ host: config.host, port: config.port })
  console.log(`trux backend listening on http://${config.host}:${config.port} (db: ${config.dbPath})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
