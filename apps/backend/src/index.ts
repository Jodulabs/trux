import 'dotenv/config'
import { loadConfig } from './config'
import { openDb } from './db'
import { buildServer } from './server'

async function main(): Promise<void> {
  const config = loadConfig()
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(`invalid TRUX_PORT: ${process.env.TRUX_PORT}`)
  }
  const db = openDb(config.dbPath)
  const app = await buildServer(config, db)
  await app.listen({ host: config.host, port: config.port })
  console.log(`trux backend listening on http://${config.host}:${config.port} (db: ${config.dbPath})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
