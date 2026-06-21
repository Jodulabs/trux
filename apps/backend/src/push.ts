import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import webpush from 'web-push'

// A VAPID keypair identifies this server to the browser push services. Generated
// once and persisted so subscriptions made against the public key keep working
// across restarts. Env overrides let an operator pin keys explicitly.
export interface VapidKeys {
  publicKey: string
  privateKey: string
}

export interface PushSubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

// The registry surface the notifier needs (kept narrow so it's trivial to fake).
export interface PushStore {
  listPushSubscriptions(): PushSubscriptionRow[]
  removePushSubscription(endpoint: string): void
}

// One push delivery. Swappable so tests don't hit the network.
export type PushSender = (sub: PushSubscriptionRow, payload: string) => Promise<void>

export interface NotifyInput {
  conversationId: string
  kind: 'approval' | 'turn'
  // Idempotency key — the request_id for an approval, the turn_id for a turn. A
  // reconnect replay or double-emit with the same key is a no-op.
  dedupeKey: string
  title: string
  body: string
}

export function defaultVapidFile(): string {
  return join(homedir(), '.trux', 'vapid.json')
}

// Resolve VAPID keys: explicit env wins; otherwise read the json file, generating
// and persisting a fresh pair on first run. Returns null if keys can't be
// established (no env + unwritable file) so the caller disables push gracefully.
export function loadOrCreateVapid(opts?: {
  file?: string
  env?: NodeJS.ProcessEnv
}): VapidKeys | null {
  const env = opts?.env ?? process.env
  if (env.TRUX_VAPID_PUBLIC && env.TRUX_VAPID_PRIVATE) {
    return { publicKey: env.TRUX_VAPID_PUBLIC, privateKey: env.TRUX_VAPID_PRIVATE }
  }
  const file = opts?.file ?? defaultVapidFile()
  try {
    const raw = readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as Partial<VapidKeys>
    if (parsed.publicKey && parsed.privateKey) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey }
    }
  } catch {
    // not yet created (or corrupt) — fall through to generate
  }
  try {
    const generated = webpush.generateVAPIDKeys()
    const keys: VapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(keys, null, 2))
    return keys
  } catch {
    return null
  }
}

// What a closed PWA gets pulled back by: an approval the agent is blocked on, or a
// finished turn. Deduped per dedupeKey; body genericized under privacy mode so a
// lockscreen preview can't leak a command or path.
export class WebPushNotifier {
  private readonly sent = new Set<string>()
  private readonly sender: PushSender
  private readonly privacy: boolean

  constructor(
    private readonly store: PushStore,
    vapid: VapidKeys,
    opts?: { sender?: PushSender; privacy?: boolean; subject?: string },
  ) {
    this.privacy = opts?.privacy ?? false
    this.sender =
      opts?.sender ??
      (async (sub, payload) => {
        webpush.setVapidDetails(opts?.subject ?? 'mailto:trux@localhost', vapid.publicKey, vapid.privateKey)
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
      })
  }

  async notify(input: NotifyInput): Promise<void> {
    if (this.sent.has(input.dedupeKey)) return
    this.sent.add(input.dedupeKey)
    const body = this.privacy
      ? input.kind === 'approval'
        ? 'Approval required'
        : 'Turn complete'
      : input.body
    const payload = JSON.stringify({
      conversationId: input.conversationId,
      kind: input.kind,
      title: input.title,
      body,
    })
    for (const sub of this.store.listPushSubscriptions()) {
      try {
        await this.sender(sub, payload)
      } catch (err) {
        // 404/410 mean the subscription is dead — prune it so we stop trying.
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) this.store.removePushSubscription(sub.endpoint)
      }
    }
  }
}


// --- Native (Expo) push ------------------------------------------------------
// The web-push protocol (above) speaks VAPID to a browser's PushSubscription
// endpoint and physically cannot reach a phone's native push channel. Native
// devices register an opaque Expo push token instead; delivery goes through the
// Expo Push Service (https://exp.host/--/api/v2/push/send), which fans out to
// APNs/FCM. This notifier mirrors WebPushNotifier's contract (same NotifyInput,
// same dedupe + privacy-genericized body) so the manager's emit path stays
// agnostic to which transport a given device uses.

// The registry surface the native notifier needs (narrow, trivial to fake).
export interface ExpoPushStore {
  listExpoPushTokens(): string[]
  removeExpoPushToken(token: string): void
}

// One Expo push message, in the Expo Push API wire shape.
export interface ExpoPushMessage {
  to: string
  title: string
  body: string
  data: { conversationId: string; kind: NotifyInput['kind'] }
}

// A push receipt ticket from the Expo Push Service. `DeviceNotRegistered` is the
// signal to prune a dead token (the native analogue of web-push's 404/410).
export interface ExpoPushTicket {
  status: 'ok' | 'error'
  details?: { error?: string }
}

// Deliver a batch of messages to the Expo Push Service. Swappable so tests don't
// hit the network. Returns one ticket per message, index-aligned.
export type ExpoPushSender = (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>

export class ExpoPushNotifier {
  private readonly sent = new Set<string>()
  private readonly sender: ExpoPushSender
  private readonly privacy: boolean

  constructor(
    private readonly store: ExpoPushStore,
    opts?: { sender?: ExpoPushSender; privacy?: boolean; endpoint?: string },
  ) {
    this.privacy = opts?.privacy ?? false
    this.sender =
      opts?.sender ??
      (async (messages) => {
        const res = await fetch(opts?.endpoint ?? 'https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(messages),
        })
        const parsed = (await res.json()) as { data?: ExpoPushTicket[] }
        return parsed.data ?? []
      })
  }

  async notify(input: NotifyInput): Promise<void> {
    if (this.sent.has(input.dedupeKey)) return
    this.sent.add(input.dedupeKey)
    const tokens = this.store.listExpoPushTokens()
    if (tokens.length === 0) return
    const body = this.privacy
      ? input.kind === 'approval'
        ? 'Approval required'
        : 'Turn complete'
      : input.body
    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: input.title,
      body,
      data: { conversationId: input.conversationId, kind: input.kind },
    }))
    try {
      const tickets = await this.sender(messages)
      // Tickets align by index with messages — prune any token the service says
      // is no longer registered so we stop trying it.
      tickets.forEach((t, i) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
          this.store.removeExpoPushToken(messages[i].to)
        }
      })
    } catch {
      // best-effort: a delivery failure must never break the turn pump
    }
  }
}

// --- Composite ---------------------------------------------------------------
// Fan one notification out to every transport (web-push + Expo). Each child
// keeps its own dedupe, so the same dedupeKey is delivered at most once per
// transport. A throw in one transport never starves the others.
interface NotifierLike {
  notify(input: NotifyInput): Promise<void>
}

export class CompositeNotifier {
  constructor(private readonly notifiers: NotifierLike[]) {}

  async notify(input: NotifyInput): Promise<void> {
    await Promise.all(this.notifiers.map((n) => n.notify(input).catch(() => {})))
  }
}
