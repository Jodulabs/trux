// The phone-facing auth contract. One adapter per provider, surfaced as the
// "Connections" screen. Mirrors the AgentAdapter registry pattern.
export type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string | null; needsCode?: boolean } // needsCode: after signing in, paste the returned code back (Claude setup-token)
  | { mode: 'apikey'; label: string } // secondary: paste a key, box stores via the CLI/file
export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'expired'

export interface Authenticator {
  readonly id: string // 'codex' | 'claude' | 'opencode' | 'fly' | …
  readonly plane: 'model' | 'machine' // decides where the credential lands
  begin(): Promise<AuthMode>
  poll(): Promise<AuthStatus> // device flow: box watches the CLI's progress
  status(): Promise<AuthStatus>
  disconnect(): Promise<void>
  submitKey?(key: string): Promise<AuthStatus> // the key fallback
  submitCode?(code: string): Promise<AuthStatus> // paste-code-back (Claude): the code shown after browser sign-in
}

// `codex login --device-auth` prints a verification URL and a user code, then
// blocks until the user completes login in their browser. Scrape both from a
// chunk of stdout. URL: first https URL on a line; code: a short A-Z0-9(-) token
// near a "code" label. Returns null until the URL has appeared.
export function parseCodexDeviceOutput(buf: string): { verifyUrl: string; userCode: string | null } | null {
  // The CLI colours its output, so strip ANSI/SGR escapes first — otherwise the
  // URL regex's [^\s]+ swallows the trailing reset (ESC[0m) and the link 404s.
  const clean = stripAnsi(buf)
  const urlMatch = /(https?:\/\/[^\s]+)/.exec(clean)
  if (!urlMatch) return null
  const verifyUrl = urlMatch[1].replace(/[).,]+$/, '') // strip trailing punctuation
  // The one-time code is a dash-joined run of uppercase letters/digits (e.g.
  // 72J2-KPLEP). Require the dash and stay case-sensitive so prose like the
  // intro line "...using device code authorization:" can't masquerade as it.
  const codeMatch = /\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b/.exec(clean)
  return { verifyUrl, userCode: codeMatch ? codeMatch[1] : null }
}

// Remove ANSI/VT escape sequences (CSI <params> <final byte>) the CLIs emit for
// colour, so URL/code scraping isn't polluted by reset codes like ESC[0m.
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

// `codex login status` prints "Logged in using ChatGPT" when authed, and a
// "Not logged in" line otherwise.
export function parseCodexStatus(out: string): AuthStatus {
  return /logged in/i.test(out) && !/not logged in/i.test(out) ? 'connected' : 'disconnected'
}

// `claude setup-token` prints a sign-in URL, then waits for the user to paste the
// code shown after they authorize in the browser. Scrape the first https URL.
export function parseClaudeSetupOutput(buf: string): { verifyUrl: string } | null {
  const m = /(https?:\/\/[^\s]+)/.exec(stripAnsi(buf))
  if (!m) return null
  return { verifyUrl: m[1].replace(/[).,]+$/, '') }
}

// `claude auth status` prints JSON, e.g. {"loggedIn":true,"authMethod":"claude.ai",…}.
// Map loggedIn→connected. (Token refresh is the SDK/CLI's job; expiry is surfaced
// by the credentials-file check in auth-claude.ts, not here.)
export function parseClaudeStatus(out: string): AuthStatus {
  try {
    const d = JSON.parse(out) as { loggedIn?: boolean }
    return d.loggedIn ? 'connected' : 'disconnected'
  } catch {
    // Fallback for non-JSON output.
    return /logged in|loggedIn.*true/i.test(out) && !/not logged in/i.test(out) ? 'connected' : 'disconnected'
  }
}
