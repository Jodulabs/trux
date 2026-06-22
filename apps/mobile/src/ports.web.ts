import { configureClient, type Storage, type ServerConfig } from '@trux/client/ports'

const HOST_KEY = 'trux_host'
const TOKEN_KEY = 'trux_token'

// Web surface = same model as the retired Vite PWA: synchronous localStorage and
// a same-origin ServerConfig (the web build is served by the trux backend itself).
const webStorage: Storage = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* quota */ } },
  remove: (k) => { try { localStorage.removeItem(k) } catch { /* */ } },
}

function locationServerConfig(): ServerConfig {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return { httpBase: '', wsBase: `${proto}//${location.host}` }
}

// Capture a token handed over in the URL fragment (#token=…) — how `trux pair`/
// `trux open` deliver it — then strip it from the address bar.
function captureFragmentToken(): void {
  const m = /[#&]token=([^&]+)/.exec(location.hash)
  if (m) {
    webStorage.set(TOKEN_KEY, decodeURIComponent(m[1]))
    history.replaceState(null, '', location.pathname + location.search)
  }
}

export async function configureNativeClient(): Promise<void> {
  captureFragmentToken()
  configureClient({ storage: webStorage, serverConfig: locationServerConfig() })
}

export function rebindHost(): void {
  configureClient({ storage: webStorage, serverConfig: locationServerConfig() })
}

// Web is same-origin: the "host" is the page origin, so only the token is stored.
export function savePair(_host: string, token: string): void {
  webStorage.set(TOKEN_KEY, token)
  rebindHost()
}
export function clearPair(): void {
  webStorage.remove(TOKEN_KEY)
  webStorage.remove(HOST_KEY)
  rebindHost()
}
export function getStoredHost(): string | null { return webStorage.get(HOST_KEY) }
export function getStoredToken(): string | null { return webStorage.get(TOKEN_KEY) }

// Pure trux-pair QR/URL parser (duplicated from ports.ts so the web bundle never
// imports the native expo-secure-store module).
export function parsePairQr(payload: string): { host: string; token: string } | null {
  try {
    const u = new URL(payload)
    const m = /[#&]token=([^&]+)/.exec(u.hash)
    if (!m) return null
    const token = decodeURIComponent(m[1])
    const host = u.host
    if (!host || !token) return null
    return { host, token }
  } catch {
    return null
  }
}
