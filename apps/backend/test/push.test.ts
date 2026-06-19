import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateVapid, WebPushNotifier, type PushSender } from '../src/push'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'trux-push-'))
  dirs.push(d)
  return d
}

describe('loadOrCreateVapid', () => {
  it('generates a keypair and persists it to disk', () => {
    const file = join(tmp(), 'vapid.json')
    const keys = loadOrCreateVapid({ file })
    expect(keys?.publicKey).toBeTruthy()
    expect(keys?.privateKey).toBeTruthy()
    expect(existsSync(file)).toBe(true)
    // Second call reads the same keys back rather than regenerating.
    const again = loadOrCreateVapid({ file })
    expect(again?.publicKey).toBe(keys?.publicKey)
    expect(again?.privateKey).toBe(keys?.privateKey)
  })

  it('prefers explicit env keys over the file', () => {
    const file = join(tmp(), 'vapid.json')
    const keys = loadOrCreateVapid({
      file,
      env: { TRUX_VAPID_PUBLIC: 'pub-from-env', TRUX_VAPID_PRIVATE: 'priv-from-env' },
    })
    expect(keys).toEqual({ publicKey: 'pub-from-env', privateKey: 'priv-from-env' })
    // Env path doesn't write a file.
    expect(existsSync(file)).toBe(false)
  })

  it('returns null when persistence fails and no env is given', () => {
    // An unwritable path (a file used as a directory) → cannot persist → disabled.
    const base = tmp()
    const asFile = join(base, 'blocker')
    writeFileSync(asFile, 'x')
    const keys = loadOrCreateVapid({ file: join(asFile, 'vapid.json') })
    expect(keys).toBeNull()
  })
})

describe('WebPushNotifier', () => {
  // A fake registry exposing just what the notifier needs.
  function fakeRegistry(subs: Array<{ endpoint: string; p256dh: string; auth: string }>) {
    const removed: string[] = []
    return {
      removed,
      listPushSubscriptions: () => subs,
      removePushSubscription: (endpoint: string) => removed.push(endpoint),
    }
  }

  const vapid = { publicKey: 'pub', privateKey: 'priv' }

  it('sends one notification per subscription with the conversation payload', async () => {
    const sent: Array<{ endpoint: string; payload: string }> = []
    const sender: PushSender = async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload })
    }
    const reg = fakeRegistry([
      { endpoint: 'https://push/a', p256dh: 'k1', auth: 'a1' },
      { endpoint: 'https://push/b', p256dh: 'k2', auth: 'a2' },
    ])
    const notifier = new WebPushNotifier(reg, vapid, { sender })
    await notifier.notify({ conversationId: 'c1', kind: 'approval', dedupeKey: 'r1', title: 'T', body: 'rm -rf' })
    expect(sent.map((s) => s.endpoint)).toEqual(['https://push/a', 'https://push/b'])
    const payload = JSON.parse(sent[0].payload) as { conversationId: string; kind: string; body: string }
    expect(payload).toMatchObject({ conversationId: 'c1', kind: 'approval', body: 'rm -rf' })
  })

  it('dedupes repeated notifications by dedupeKey', async () => {
    const sent: string[] = []
    const sender: PushSender = async (sub) => { sent.push(sub.endpoint) }
    const reg = fakeRegistry([{ endpoint: 'https://push/a', p256dh: 'k', auth: 'a' }])
    const notifier = new WebPushNotifier(reg, vapid, { sender })
    await notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    await notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    expect(sent).toHaveLength(1)
  })

  it('genericizes the body in privacy mode', async () => {
    const sent: string[] = []
    const sender: PushSender = async (_sub, payload) => { sent.push(payload) }
    const reg = fakeRegistry([{ endpoint: 'https://push/a', p256dh: 'k', auth: 'a' }])
    const notifier = new WebPushNotifier(reg, vapid, { sender, privacy: true })
    await notifier.notify({ conversationId: 'c1', kind: 'approval', dedupeKey: 'r1', title: 'T', body: 'rm -rf /' })
    const payload = JSON.parse(sent[0]) as { body: string }
    expect(payload.body).toBe('Approval required')
    expect(payload.body).not.toContain('rm -rf')
  })

  it('prunes a subscription the push service rejects with 410', async () => {
    const reg = fakeRegistry([{ endpoint: 'https://push/gone', p256dh: 'k', auth: 'a' }])
    const sender: PushSender = async () => {
      throw Object.assign(new Error('gone'), { statusCode: 410 })
    }
    const notifier = new WebPushNotifier(reg, vapid, { sender })
    await notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    expect(reg.removed).toEqual(['https://push/gone'])
  })
})
