import 'dotenv/config'
import { loadConfig } from './config'
import { openDb } from './db'
import { SqliteRegistry } from './registry'
import { ClaudeAdapter } from './adapter/claude'
import { ConversationManager } from './manager'
import { buildServer } from './server'

async function main(): Promise<void> {
  const config = loadConfig()
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`invalid TRUX_PORT: ${process.env.TRUX_PORT}`)
  }
  const db = openDb(config.dbPath)
  const registry = new SqliteRegistry(db)
  const manager = new ConversationManager(registry, new ClaudeAdapter())
  const app = await buildServer(config, db, registry, manager)
  await app.listen({ host: config.host, port: config.port })
  console.log(`trux backend listening on http://${config.host}:${config.port} (db: ${config.dbPath})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
