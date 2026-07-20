import { spawnSync } from 'node:child_process'
import type { AgentCapabilities, AgentControl, ControlOption } from '@trux/protocol'

// Capability discovery: each agent's installed CLI is the source of truth for
// available models and native controls. Trux caches the last successful result
// briefly (CLIs don't change often) and falls back to an empty manifest + the
// agent's native default on any failure — conversation creation is never
// blocked by a discovery error.

export interface Discoverer {
  discover(): AgentCapabilities
}

// Spawn-to-string seam, injectable for tests. Returns stdout or null on error.
export type RunFn = (cmd: string, args: string[]) => string | null

export const defaultRun: RunFn = (cmd, args) => {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return r.status === 0 && r.stdout ? r.stdout : null
  } catch {
    return null
  }
}

// ─── Cache ───────────────────────────────────────────────────────────────────
// One cache per agent key. The discoverer is called on every capabilities()
// call (which the catalog hits per /catalog request); the CLI spawn is only
// triggered when the cache expires. A failed spawn keeps the previous cache so
// a transient CLI error doesn't wipe the manifest.
interface CacheEntry { caps: AgentCapabilities; expiry: number; fetching: boolean }
const cache = new Map<string, CacheEntry>()

function readCache(key: string): AgentCapabilities | null {
  const entry = cache.get(key)
  if (!entry || Date.now() >= entry.expiry) return null
  return entry.caps
}

function writeCache(key: string, caps: AgentCapabilities, ttlMs: number): void {
  cache.set(key, { caps, expiry: Date.now() + ttlMs, fetching: false })
}

// Test seam: clear the in-memory cache so a fresh discover() call re-runs the
// spawn. Not used in production (the cache is benign — it just avoids respawning
// the CLI on every /catalog request).
export function clearDiscoveryCache(): void {
  cache.clear()
}

// ─── Pi ──────────────────────────────────────────────────────────────────────
// `pi --list-models` prints a whitespace-aligned table:
//   provider        model                                             context  max-out  thinking  images
//   amazon-bedrock  amazon.nova-2-lite-v1:0                           128K     4.1K     yes       yes
// Parse by splitting on 2+ spaces (the columns are padded, but model ids and
// provider names don't contain internal double-spaces). The `provider/model`
// form is what pi --model accepts, so that's the value we surface.
const PI_THINKING: AgentControl = {
  key: 'thinking',
  label: 'Thinking',
  options: [
    { value: 'off', label: 'Off' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra high' },
    { value: 'max', label: 'Max' },
  ],
  default: '',
}

export function parsePiModelsTable(stdout: string): ControlOption[] {
  const lines = stdout.split('\n')
  const models: ControlOption[] = []
  // Skip the header line; find it by its first column being literally "provider".
  let started = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!started) {
      if (/^provider\s/i.test(trimmed)) started = true
      continue
    }
    // Split on 2+ spaces. provider and model are the first two columns.
    const cols = trimmed.split(/\s{2,}/)
    if (cols.length < 2) continue
    const provider = cols[0]
    const model = cols[1]
    if (!provider || !model) continue
    const value = `${provider}/${model}`
    // Label: the model id alone is enough — the provider prefix is noise in a
    // long list. The value still carries it so pi --model gets the full form.
    const label = model
    // Dedup by value (a model may appear under multiple regional providers).
    if (!models.some((m) => m.value === value)) models.push({ value, label })
  }
  return models
}

const PI_TTL = 5 * 60_000 // 5 min

export class PiDiscoverer implements Discoverer {
  constructor(private readonly run: RunFn = defaultRun) {}

  discover(): AgentCapabilities {
    const cached = readCache('pi')
    if (cached) return cached
    const stdout = this.run('pi', ['--list-models'])
    const models = stdout ? parsePiModelsTable(stdout) : []
    const caps: AgentCapabilities = {
      agent: 'pi',
      models,
      defaultModel: null,
      controls: [PI_THINKING],
    }
    // Cache even on empty (failed spawn) so a broken CLI doesn't get hammered
    // on every /catalog request — but use a shorter TTL so a retry happens soon.
    writeCache('pi', caps, models.length > 0 ? PI_TTL : 30_000)
    return caps
  }
}

// ─── opencode ────────────────────────────────────────────────────────────────
// `opencode models` prints one `provider/model` per line:
//   opencode/big-pickle
//   opencode-go/glm-5.2
//   amazon-bedrock/anthropic.claude-fable-5
// The value pi --model accepts is exactly this form. Label: the model id
// (after the slash), since the provider prefix is redundant in a long list.
export function parseOpencodeModelsLines(stdout: string): ControlOption[] {
  const models: ControlOption[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('/')) continue
    const [provider, ...rest] = trimmed.split('/')
    const model = rest.join('/')
    if (!provider || !model) continue
    const value = trimmed
    const label = model
    if (!models.some((m) => m.value === value)) models.push({ value, label })
  }
  return models
}

const OPENCODE_TTL = 5 * 60_000 // 5 min

export class OpencodeDiscoverer implements Discoverer {
  constructor(private readonly run: RunFn = defaultRun) {}

  discover(): AgentCapabilities {
    const cached = readCache('opencode')
    if (cached) return cached
    const stdout = this.run('opencode', ['models'])
    const models = stdout ? parseOpencodeModelsLines(stdout) : []
    const caps: AgentCapabilities = {
      agent: 'opencode',
      models,
      defaultModel: null,
      controls: [],
    }
    writeCache('opencode', caps, models.length > 0 ? OPENCODE_TTL : 30_000)
    return caps
  }
}

// ─── Codex ───────────────────────────────────────────────────────────────────
// Codex has no model list command — `-m <model>` accepts a free string. The
// honest manifest is empty: the user types a model id or accepts the native
// default. No discovery spawn, no cache.
export class CodexDiscoverer implements Discoverer {
  discover(): AgentCapabilities {
    return { agent: 'codex', models: [], defaultModel: null, controls: [] }
  }
}
