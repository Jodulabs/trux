import { getServerConfig, getStorage } from './ports'

// Derive an http(s) base from the server config. Prefer an explicit httpBase;
// otherwise swap the ws(s) scheme of wsBase to http(s). On web both are empty
// strings (same-origin) — previewUrl then yields a root-relative URL.
function httpBase(): string {
  const { httpBase, wsBase } = getServerConfig()
  if (httpBase) return httpBase
  if (wsBase) return wsBase.replace(/^ws(s?):\/\//, 'http$1://')
  return ''
}

// Build the tokenized path-prefix URL for a dev server on <port>, proxied
// through trux's origin. The token rides the query once; the proxy validates it,
// sets the trux_preview cookie, and strips it from the URL (see preview.ts).
export function previewUrl(port: number): string {
  const base = httpBase()
  const token = getStorage().get('trux_token') ?? ''
  const path = `/__preview__/${port}/?__trux_token=${encodeURIComponent(token)}`
  return `${base}${path}`
}
