const SHELL = 'trux-v1'
const ASSETS = ['/', '/manifest.json']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = e.request.url
  // Pass API and WS requests through — never cache them
  if (url.includes('/conversations') || url.includes('/workspaces') ||
      url.includes('/agents') || url.includes('/config') || url.includes('/health')) return
  e.respondWith(
    caches.match(e.request).then((hit) => hit ?? fetch(e.request))
  )
})
