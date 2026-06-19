// Push-only service worker. Deliberately caches NOTHING and has no fetch
// handler, so every request goes straight to the network exactly as if no SW
// were installed. A live agent console is useless offline (it needs the REST
// API and the WebSocket stream), so an offline shell bought nothing — and a
// precached, content-hashed shell actively *trapped* clients: after a rebuild
// the cached HTML pointed at a deleted JS bundle, and the SW kept serving it
// forever with no automatic recovery (the "blank screen, reload does nothing"
// bug). The SW now exists solely to receive web push and deep-link on tap.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Evict every cache any earlier SW version created. This is what frees a
      // client that's stuck on a stale shell from a previous build.
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.clients.claim()
      // Force any already-open page onto fresh network HTML in a single step —
      // no "reload twice / clear site data / use incognito" dance for the user.
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const c of clients) {
        try {
          await c.navigate(c.url)
        } catch {
          // navigate() is unsupported on some engines (older iOS Safari); with
          // no fetch handler the user's next ordinary reload is already clean.
        }
      }
    })(),
  )
})

// --- Web push: the reason to own a phone client. The server emits a push when an
// agent needs you (approval) or finishes a turn; we surface it as a notification,
// but suppress it if a visible tab is already focused on that conversation (the
// open app already has haptics — a banner would be noise).
self.addEventListener('push', (e) => {
  let data = {}
  try {
    data = e.data ? e.data.json() : {}
  } catch {
    data = {}
  }
  const conversationId = data.conversationId || ''
  const title = data.title || 'trux'
  const body = data.body || ''
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const focusedHere = all.some(
        (c) => c.visibilityState === 'visible' && c.url.includes(`c=${conversationId}`),
      )
      if (focusedHere) return // foregrounded on this conversation → no banner
      await self.registration.showNotification(title, {
        body,
        tag: conversationId || 'trux',
        data: { conversationId },
        badge: '/icon-192.png',
        icon: '/icon-192.png',
      })
    })(),
  )
})

// Tap the notification → focus an existing tab and deep-link it, or open one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const conversationId = (e.notification.data && e.notification.data.conversationId) || ''
  const target = conversationId ? `/?c=${conversationId}` : '/'
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of all) {
        if ('focus' in c) {
          c.postMessage({ type: 'trux:navigate', conversationId })
          return c.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })(),
  )
})
