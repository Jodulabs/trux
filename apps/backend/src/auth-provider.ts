// The phone-facing auth contract. One adapter per provider, surfaced as the
// "Connections" screen. Mirrors the AgentAdapter registry pattern.
export type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string | null } // relay URL→phone; box watches the CLI
  | { mode: 'apikey'; label: string } // secondary: paste a key, box stores via the CLI
export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'expired'

export interface Authenticator {
  readonly id: string // 'codex' | 'claude' | 'opencode' | 'fly' | …
  readonly plane: 'model' | 'machine' // decides where the credential lands
  begin(): Promise<AuthMode>
  poll(): Promise<AuthStatus> // device flow: box watches the CLI's progress
  status(): Promise<AuthStatus>
  disconnect(): Promise<void>
  submitKey?(key: string): Promise<AuthStatus> // the key fallback
}

// `codex login --device-auth` prints a verification URL and a user code, then
// blocks until the user completes login in their browser. Scrape both from a
// chunk of stdout. URL: first https URL on a line; code: a short A-Z0-9(-) token
// near a "code" label. Returns null until the URL has appeared.
export function parseCodexDeviceOutput(buf: string): { verifyUrl: string; userCode: string | null } | null {
  const urlMatch = /(https?:\/\/[^\s]+)/.exec(buf)
  if (!urlMatch) return null
  const verifyUrl = urlMatch[1].replace(/[).,]+$/, '') // strip trailing punctuation
  const codeMatch = /code[^A-Z0-9]*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})?)/i.exec(buf)
  return { verifyUrl, userCode: codeMatch ? codeMatch[1] : null }
}

// `codex login status` prints "Logged in using ChatGPT" when authed, and a
// "Not logged in" line otherwise.
export function parseCodexStatus(out: string): AuthStatus {
  return /logged in/i.test(out) && !/not logged in/i.test(out) ? 'connected' : 'disconnected'
}
