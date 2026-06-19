// Bump SHELL to evict stale caches on deploy.
const SHELL = 'trux-v4'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
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

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // API + WS + config: always network, never cache.
  if (/^\/(conversations|workspaces|agents|sessions|config|health)/.test(url.pathname)) return

  // Navigations (HTML): network-first so a new build is picked up immediately;
  // fall back to the cached shell when offline. This is what makes UI updates show.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          void caches.open(SHELL).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit ?? caches.match(e.request))),
    )
    return
  }

  // Hashed static assets (immutable): cache-first, populate on first fetch.
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ??
        fetch(e.request).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone()
            void caches.open(SHELL).then((c) => c.put(e.request, copy))
          }
          return res
        }),
    ),
  )
})
