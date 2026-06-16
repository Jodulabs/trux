import { config as loadDotenv } from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import qrcode from 'qrcode-terminal'
import type { AgentName } from '@trux/protocol'
import { loadConfig, assertConfig, type Config } from './config'
import { openDb } from './db'
import { SqliteRegistry } from './registry'
import { ClaudeAdapter } from './adapter/claude'
import { CodexAdapter } from './adapter/codex'
import { OpencodeAdapter } from './adapter/opencode'
import { ConversationManager } from './manager'
import type { AgentAdapter } from './adapter/types'
import { buildServer } from './server'

// Load env before reading config: repo-local .env first (dev), then ~/.trux/.env
// (the deployed box). dotenv never overrides an already-set var, so the first load
// wins per key — and a foreground `pnpm start` now works without systemd.
loadDotenv()
const userEnv = join(homedir(), '.trux', '.env')
if (existsSync(userEnv)) loadDotenv({ path: userEnv })

// Print how to reach trux. When a tailnet host + secret are configured, show a QR
// that pairs a phone in one scan (URL + token in the fragment — see frontend pairing).
function printAccessBanner(config: Config): void {
  if (config.tailscaleHost) {
    const base = `https://${config.tailscaleHost}/`
    if (config.secret) {
      console.log('\n📱 Pair your phone — scan this (phone must be on the tailnet):\n')
      qrcode.generate(`${base}#token=${encodeURIComponent(config.secret)}`, { small: true })
      console.log(`\n   …or open ${base} and paste your token`)
    } else {
      console.log(`\n📱 Phone: open ${base} (auth disabled)`)
    }
  }
  console.log(`\n   local: http://localhost:${config.port}/\n`)
}

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
  printAccessBanner(config)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
