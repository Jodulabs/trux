import type { AgentName } from '@trux/protocol'
import { loadEnvFiles, printStartBanner } from './banner'
import { loadConfig, assertConfig } from './config'
import { openDb } from './db'
import { SqliteRegistry } from './registry'
import { ClaudeAdapter } from './adapter/claude'
import { CodexAdapter } from './adapter/codex'
import { OpencodeAdapter } from './adapter/opencode'
import { ConversationManager } from './manager'
import type { AgentAdapter } from './adapter/types'
import { buildServer } from './server'
import { CodexAuthenticator } from './auth-codex'
import { ClaudeAuthenticator } from './auth-claude'
import { OpencodeAuthenticator } from './auth-opencode'
import type { Authenticator } from './auth-provider'
import { loadOrCreateVapid, WebPushNotifier, ExpoPushNotifier, CompositeNotifier } from './push'
import type { Notifier } from './manager'

loadEnvFiles()

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
  // Model-plane authenticators (display order = screen order). Codex shipped in
  // Phase 1; claude + opencode added in Phase 2a. Machine providers follow later.
  const authenticators = new Map<string, Authenticator>([
    ['claude', new ClaudeAuthenticator()],
    ['codex', new CodexAuthenticator()],
    ['opencode', new OpencodeAuthenticator()],
  ])
  // Notifications fan out to every transport a device might use. Web-push needs
  // VAPID (env, persisted file, or freshly generated); if keys can't be set up,
  // the web transport is dropped but the rest of trux — and native push — runs
  // unchanged. Native (Expo) push needs no server keys: it delivers through the
  // Expo Push Service keyed by a per-device token, so it's always available.
  const vapid = loadOrCreateVapid()
  const transports: Notifier[] = []
  if (vapid) {
    transports.push(new WebPushNotifier(registry, vapid, { privacy: config.pushPrivacy }))
  } else {
    console.log('trux: web-push disabled (no VAPID keys)')
  }
  transports.push(new ExpoPushNotifier(registry, { privacy: config.pushPrivacy }))
  const notifier = transports.length > 0 ? new CompositeNotifier(transports) : null
  const manager = new ConversationManager(registry, adapters, notifier)
  const app = await buildServer(config, db, registry, manager, {
    vapidPublicKey: vapid?.publicKey ?? null,
    authenticators,
  })
  await app.listen({ host: config.host, port: config.port })
  console.log(`trux backend listening on http://${config.host}:${config.port} (db: ${config.dbPath})`)
  printStartBanner(config)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
