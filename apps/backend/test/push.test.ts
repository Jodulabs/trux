import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateVapid, WebPushNotifier, ExpoPushNotifier, CompositeNotifier, type PushSender, type ExpoPushSender, type ExpoPushMessage, type ExpoPushTicket } from '../src/push'

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

describe('ExpoPushNotifier', () => {
  function fakeStore(tokens: string[]) {
    const removed: string[] = []
    return {
      removed,
      listExpoPushTokens: () => tokens,
      removeExpoPushToken: (t: string) => removed.push(t),
    }
  }

  it('sends one message per token with the conversation payload', async () => {
    const sent: ExpoPushMessage[][] = []
    const sender: ExpoPushSender = async (messages) => {
      sent.push(messages)
      return messages.map(() => ({ status: 'ok' }) as ExpoPushTicket)
    }
    const store = fakeStore(['ExponentPushToken[a]', 'ExponentPushToken[b]'])
    const notifier = new ExpoPushNotifier(store, { sender })
    await notifier.notify({ conversationId: 'c1', kind: 'approval', dedupeKey: 'r1', title: 'T', body: 'rm -rf' })
    expect(sent).toHaveLength(1)
    expect(sent[0].map((m) => m.to)).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]'])
    expect(sent[0][0]).toMatchObject({
      title: 'T',
      body: 'rm -rf',
      data: { conversationId: 'c1', kind: 'approval' },
    })
  })

  it('is a no-op when there are no tokens', async () => {
    let called = 0
    const sender: ExpoPushSender = async (messages) => {
      called++
      return messages.map(() => ({ status: 'ok' }) as ExpoPushTicket)
    }
    const notifier = new ExpoPushNotifier(fakeStore([]), { sender })
    await notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    expect(called).toBe(0)
  })

  it('dedupes repeated notifications by dedupeKey', async () => {
    let calls = 0
    const sender: ExpoPushSender = async (messages) => {
      calls++
      return messages.map(() => ({ status: 'ok' }) as ExpoPushTicket)
    }
    const notifier = new ExpoPushNotifier(fakeStore(['ExponentPushToken[a]']), { sender })
    await notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    await notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    expect(calls).toBe(1)
  })

  it('genericizes the body in privacy mode', async () => {
    const sent: ExpoPushMessage[][] = []
    const sender: ExpoPushSender = async (messages) => {
      sent.push(messages)
      return messages.map(() => ({ status: 'ok' }) as ExpoPushTicket)
    }
    const notifier = new ExpoPushNotifier(fakeStore(['ExponentPushToken[a]']), { sender, privacy: true })
    await notifier.notify({ conversationId: 'c1', kind: 'approval', dedupeKey: 'r1', title: 'T', body: 'rm -rf /' })
    expect(sent[0][0].body).toBe('Approval required')
    expect(sent[0][0].body).not.toContain('rm -rf')
  })

  it('prunes a token the Expo service reports as DeviceNotRegistered', async () => {
    const sender: ExpoPushSender = async (messages) =>
      messages.map((_m, i) =>
        i === 0
          ? ({ status: 'error', details: { error: 'DeviceNotRegistered' } } as ExpoPushTicket)
          : ({ status: 'ok' } as ExpoPushTicket),
      )
    const store = fakeStore(['ExponentPushToken[dead]', 'ExponentPushToken[live]'])
    const notifier = new ExpoPushNotifier(store, { sender })
    await notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    expect(store.removed).toEqual(['ExponentPushToken[dead]'])
  })

  it('swallows sender errors so a delivery failure never breaks the turn pump', async () => {
    const sender: ExpoPushSender = async () => {
      throw new Error('network down')
    }
    const notifier = new ExpoPushNotifier(fakeStore(['ExponentPushToken[a]']), { sender })
    await expect(
      notifier.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' }),
    ).resolves.toBeUndefined()
  })
})

describe('CompositeNotifier', () => {
  it('fans one notification out to every transport', async () => {
    const hitA: string[] = []
    const hitB: string[] = []
    const a = { notify: async (i: { dedupeKey: string }) => { hitA.push(i.dedupeKey) } }
    const b = { notify: async (i: { dedupeKey: string }) => { hitB.push(i.dedupeKey) } }
    const composite = new CompositeNotifier([a, b])
    await composite.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' })
    expect(hitA).toEqual(['t1'])
    expect(hitB).toEqual(['t1'])
  })

  it('isolates a throwing transport from the others', async () => {
    const hit: string[] = []
    const bad = { notify: async () => { throw new Error('boom') } }
    const good = { notify: async (i: { dedupeKey: string }) => { hit.push(i.dedupeKey) } }
    const composite = new CompositeNotifier([bad, good])
    await expect(
      composite.notify({ conversationId: 'c1', kind: 'turn', dedupeKey: 't1', title: 'T', body: 'done' }),
    ).resolves.toBeUndefined()
    expect(hit).toEqual(['t1'])
  })
})
