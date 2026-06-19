// Client side of web-push: turn the server's VAPID public key into a browser
// PushSubscription and register it. Best-effort — push is a bonus, never required
// for the app to work, so every failure path degrades silently.

// VAPID public keys are base64url; the PushManager wants a Uint8Array.
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  // Back the view with a concrete ArrayBuffer so it satisfies BufferSource (the
  // PushManager applicationServerKey type rejects a SharedArrayBuffer-backed view).
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Subscribe this device for push and POST the subscription to the server. No-op
// (resolves false) when push isn't available or no VAPID key is configured.
export async function subscribeToPush(
  vapidPublicKey: string | null,
  postSubscription: (sub: PushSubscriptionJSON) => Promise<void>,
): Promise<boolean> {
  if (!vapidPublicKey) return false
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  if (typeof Notification === 'undefined' || !('PushManager' in globalThis)) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }))
    await postSubscription(sub.toJSON())
    return true
  } catch {
    return false
  }
}
