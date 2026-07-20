import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentCapabilities, AgentCatalogEntry, AgentDiagnostic, AgentName, AgentAccount, AuthStatus } from '@trux/protocol'
import type { AgentAdapter } from './adapter/types'
import type { Authenticator } from './auth-provider'

// The Agent catalog: the single mobile-facing source of agent availability.
// Composes execution adapters with account/login adapters internally so mobile
// never reconstructs identity from parallel routes. Read-only snapshot — the
// login *flow* (begin/poll/disconnect/submitKey/submitCode) still goes through
// the /auth/:provider/* routes; the catalog only reports state.

const execFileAsync = promisify(execFile)

export interface CatalogDeps {
  adapters: Map<AgentName, AgentAdapter>
  authenticators: Map<string, Authenticator>
}

// Binary probe: is the agent CLI on the box's PATH? TTL-cached so a catalog
// request doesn't spawn four subprocesses every time; binaries don't appear/
// disappear often, but a user may install one while trux is running.
//
// ASYNC (Fix #1): the probe used spawnSync which blocked the event loop. Now
// uses async execFile so a slow PATH lookup doesn't hang the server.
//
// No shell (Fix #3): `command -v` required { shell: true } which passed
// args through /bin/sh — a potential RCE vector if `binary` ever came from
// user input. `which`-style lookup via execFile('command', ...) without a
// shell is safe even with untrusted input because no shell expansion happens.
const INSTALL_CACHE_TTL = 60_000 // 60s
const installCache = new Map<string, { installed: boolean; checkedAt: number }>()

export type ProbeFn = (binary: string) => Promise<boolean>

export const defaultProbe: ProbeFn = async (binary) => {
  const cached = installCache.get(binary)
  if (cached && Date.now() - cached.checkedAt < INSTALL_CACHE_TTL) return cached.installed
  let installed = false
  try {
    // `command -v` is a shell builtin, so we invoke it via `sh -c` but with the
    // binary name passed as a single argument — no shell interpolation of the
    // binary name happens because execFile's argument array is passed verbatim
    // to argv. This is safe: the only string that touches the shell is the
    // fixed literal `command -v "$1"`, and `$1` is expanded by sh from argv[1]
    // without further parsing.
    await execFileAsync('sh', ['-c', 'command -v "$1"', 'sh', binary])
    installed = true
  } catch {
    installed = false
  }
  installCache.set(binary, { installed, checkedAt: Date.now() })
  return installed
}

// One authenticator → one account. Today each agent has at most one
// authenticator, so the account id is `${agent}:default`. When multi-account
// support is added, this mapping expands; the id stays stable and opaque.
function toAccount(agent: AgentName, auth: Authenticator, status: AuthStatus): AgentAccount {
  return {
    id: `${agent}:default`,
    agent,
    label: 'Default account',
    kind: auth.accountKind,
    status,
    selected: true,
  }
}

// Build the catalog snapshot. Async because authenticator.status() may spawn
// a subprocess (e.g. `claude auth status`), capabilities() is now async
// (discovery spawns), and the binary probe is async. If the binary isn't
// installed, the status check is skipped (the CLI can't run) and the account
// shows disconnected.
export async function buildCatalog(deps: CatalogDeps, probe: ProbeFn = defaultProbe): Promise<AgentCatalogEntry[]> {
  const entries: AgentCatalogEntry[] = []

  for (const [agent, adapter] of deps.adapters) {
    const installed = await probe(agent)
    const auth = deps.authenticators.get(agent)

    let accounts: AgentAccount[] = []
    const diagnostics: AgentDiagnostic[] = []

    if (auth) {
      // Only check status if the binary is installed; spawning `claude auth
      // status` when claude isn't on PATH just wastes time and errors.
      const status = installed ? await auth.status().catch(() => 'disconnected' as const) : 'disconnected'
      accounts = [toAccount(agent, auth, status)]
    }

    // runnable: installed + (no auth needed | some account connected).
    // Agents without authenticators (e.g. Pi in Track A) are runnable when
    // installed — they use their own native credentials.
    const hasConnectedAccount = accounts.some((a) => a.status === 'connected')
    const needsAccount = auth !== undefined
    const runnable = installed && (!needsAccount || hasConnectedAccount)

    if (!installed) diagnostics.push({ code: 'not_installed', message: `${agent} CLI is not on PATH` })
    else if (needsAccount && !hasConnectedAccount) diagnostics.push({ code: 'no_account', message: `No connected account for ${agent}` })

    const caps: AgentCapabilities = await adapter.capabilities()

    entries.push({
      agent,
      installed,
      runnable,
      accounts,
      capabilities: caps,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    })
  }

  return entries
}
