import * as SecureStore from 'expo-secure-store'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { configureClient, type Storage, type ServerConfig } from '@trux/client/ports'

// Keys that hold small secrets — backed by the platform keychain/keystore via
// expo-secure-store. Everything else (outbox queues, drafts) is backed by
// AsyncStorage, which has no size limit but is not encrypted-at-rest.
const SECURE_KEYS = new Set(['trux_token', 'trux_host'])

const HOST_KEY = 'trux_host'
const TOKEN_KEY = 'trux_token'

// Sync in-memory cache hydrated at boot from the async backing stores. The
// @trux/client Storage port is sync (the PWA's localStorage is sync); native
// stores are async, so we load once before the spine runs and write through on
// every mutation. A boot-time await in configureNativeClient guarantees the
// cache is populated before any spine code reads it.
const cache = new Map<string, string>()

// AsyncStorage lacks a key-list API that's also fast, so we keep an index of
// non-secure keys we've written, persisted under one index key. Hydrate loads
// them all; writes update the index. The outbox keys (`trux_outbox_*`) are the
// main occupants.
const INDEX_KEY = 'trux_keys_index'

function readIndex(): string[] {
  const raw = cache.get(INDEX_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

const nativeStorage: Storage = {
  get: (k) => cache.get(k) ?? null,
  set: (k, v) => {
    cache.set(k, v)
    void writeThrough(k, v)
  },
  remove: (k) => {
    cache.delete(k)
    void removeThrough(k)
  },
}

async function writeThrough(key: string, value: string): Promise<void> {
  try {
    if (SECURE_KEYS.has(key)) {
      await SecureStore.setItemAsync(key, value)
    } else {
      await AsyncStorage.setItem(key, value)
      const keys = new Set(readIndex())
      keys.add(key)
      const next = [...keys]
      cache.set(INDEX_KEY, JSON.stringify(next))
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next))
    }
  } catch {
    // storage full / unavailable — best-effort, mirrors the web port's policy
  }
}

async function removeThrough(key: string): Promise<void> {
  try {
    if (SECURE_KEYS.has(key)) {
      await SecureStore.deleteItemAsync(key)
    } else {
      await AsyncStorage.removeItem(key)
      const keys = readIndex().filter((k) => k !== key)
      cache.set(INDEX_KEY, JSON.stringify(keys))
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(keys))
    }
  } catch {
    // best-effort
  }
}

// Load every persisted key into the in-memory cache. Called once at app boot,
// before configureClient — the await guarantees the sync port never sees a
// stale empty cache. Safe to call more than once (idempotent read).
async function hydrate(): Promise<void> {
  // Secure secrets.
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null)
  if (token) cache.set(TOKEN_KEY, token)
  const host = await SecureStore.getItemAsync(HOST_KEY).catch(() => null)
  if (host) cache.set(HOST_KEY, host)
  // Non-secure keys (outbox queues, drafts) via the index.
  const indexRaw = await AsyncStorage.getItem(INDEX_KEY).catch(() => null)
  if (indexRaw) {
    cache.set(INDEX_KEY, indexRaw)
    const keys = readIndex()
    await Promise.all(
      keys.map(async (k) => {
        const v = await AsyncStorage.getItem(k).catch(() => null)
        if (v != null) cache.set(k, v)
      }),
    )
  }
}

// Derive the WS base from the paired host. Host is stored without a scheme
// (e.g. `box.ts.net` or `192.168.1.4:4317`); the native app always speaks wss
// to a tailnet host over TLS, ws to a raw LAN IP.
function wsBaseForHost(host: string): string {
  const looksTailscale = host.endsWith('.ts.net') || host.endsWith('.ts.net:443')
  return looksTailscale ? `wss://${host}` : `ws://${host}`
}

function httpBaseForHost(host: string): string {
  const looksTailscale = host.endsWith('.ts.net') || host.endsWith('.ts.net:443')
  return looksTailscale ? `https://${host}` : `http://${host}`
}

function serverConfigFromCache(): ServerConfig {
  const host = cache.get(HOST_KEY)
  if (!host) return { httpBase: '', wsBase: '' }
  return { httpBase: httpBaseForHost(host), wsBase: wsBaseForHost(host) }
}

// Wire the shared spine to native ports. Await this once at app boot before
// rendering anything that touches the spine (store, api, connectionManager).
export async function configureNativeClient(): Promise<void> {
  await hydrate()
  configureClient({
    storage: nativeStorage,
    serverConfig: serverConfigFromCache(),
  })
}

// Re-bind ServerConfig after a fresh pair (host + token changed). The spine
// reads ServerConfig live on every connection open / fetch, so a re-bind is
// enough — no need to reload the app.
export function rebindHost(): void {
  configureClient({
    storage: nativeStorage,
    serverConfig: serverConfigFromCache(),
  })
}

// Persistence helpers for the pair flow (A3). The token goes through the
// Storage port so the spine sees it; the host goes there too so ServerConfig
// can derive bases. Both are secure-store backed because of SECURE_KEYS.
export function savePair(host: string, token: string): void {
  nativeStorage.set(HOST_KEY, host)
  nativeStorage.set(TOKEN_KEY, token)
  rebindHost()
}

export function clearPair(): void {
  nativeStorage.remove(HOST_KEY)
  nativeStorage.remove(TOKEN_KEY)
  rebindHost()
}

export function getStoredHost(): string | null {
  return nativeStorage.get(HOST_KEY)
}

export function getStoredToken(): string | null {
  return nativeStorage.get(TOKEN_KEY)
}

// Parse a `trux pair` QR payload: `https://<host>.ts.net/#token=<bearer>`.
// Returns null if the payload is not a trux pairing URL (no host or no token).
export function parsePairQr(payload: string): { host: string; token: string } | null {
  try {
    const u = new URL(payload)
    const m = /[#&]token=([^&]+)/.exec(u.hash)
    if (!m) return null
    const token = decodeURIComponent(m[1])
    // Drop any explicit port the QR carries — trux's backend serves REST + WS
    // on one port. Keep the host (and port if present) as the connection target.
    const host = u.host
    if (!host || !token) return null
    return { host, token }
  } catch {
    return null
  }
}
