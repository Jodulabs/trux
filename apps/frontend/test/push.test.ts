import { describe, expect, it, vi } from 'vitest'
import { subscribeToPush, urlBase64ToUint8Array } from '../src/push'

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url VAPID key to bytes', () => {
    // "hello" in base64url is "aGVsbG8"
    const bytes = urlBase64ToUint8Array('aGVsbG8')
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111])
  })
})

describe('subscribeToPush', () => {
  it('is a no-op when no VAPID key is configured', async () => {
    const post = vi.fn()
    const ok = await subscribeToPush(null, post)
    expect(ok).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('is a no-op when push APIs are unavailable', async () => {
    const post = vi.fn()
    // jsdom has no PushManager/serviceWorker — should degrade silently.
    const ok = await subscribeToPush('somekey', post)
    expect(ok).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })
})
