import { configureClient, type Storage, type ServerConfig } from '@trux/client/ports'

// Web Storage port: backed by localStorage. try/catch guards private-mode
// browsers where localStorage throws on access.
const webStorage: Storage = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      // storage unavailable — best-effort
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      // best-effort
    }
  },
}

// Web ServerConfig: same-origin relative HTTP (httpBase: '' preserves today's
// fetch('/…')) and a WS base derived from the page location. Native binds both
// from the paired host instead.
function webServerConfig(): ServerConfig {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return { httpBase: '', wsBase: `${proto}//${location.host}` }
}

// Wire the shared spine to the web ports. Call once before any spine code runs
// (main.tsx in the app, test/setup.ts in tests).
export function configureWebClient(): void {
  configureClient({ storage: webStorage, serverConfig: webServerConfig() })
}
