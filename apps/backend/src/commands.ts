import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { AgentCommand, AgentCommandArg } from '@trux/protocol'

// Recursively collect *.md files under dir (returns [] if dir is absent).
function walkMd(dir: string): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return [] }
  const out: string[] = []
  for (const e of entries) {
    const full = join(dir, e)
    let s: ReturnType<typeof statSync>
    try { s = statSync(full) } catch { continue }
    if (s.isDirectory()) out.push(...walkMd(full))
    else if (e.endsWith('.md')) out.push(full)
  }
  return out
}

// Split optional leading YAML frontmatter (only simple `key: value` lines read).
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) return { meta: {}, body: text }
  const end = text.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of text.slice(4, end).split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (k) meta[k] = v
  }
  return { meta, body: text.slice(end + 4).replace(/^\n/, '') }
}

// Detect the portable placeholders the palette can prompt for.
function detectArgs(body: string, hint: string): AgentCommandArg[] {
  const args: AgentCommandArg[] = []
  if (/\$ARGUMENTS\b/.test(body)) args.push({ name: 'ARGUMENTS', label: hint || 'Arguments', required: true })
  const positional = new Set<string>()
  for (const m of body.matchAll(/\$([1-9])(?![0-9])/g)) positional.add(m[1])
  for (const d of [...positional].sort()) args.push({ name: d, label: `Argument ${d}`, required: true })
  return args
}

function readDir(dir: string): AgentCommand[] {
  const cmds: AgentCommand[] = []
  for (const file of walkMd(dir)) {
    let raw: string
    try { raw = readFileSync(file, 'utf8') } catch { continue }
    const { meta, body } = parseFrontmatter(raw)
    const name = relative(dir, file).replace(/\.md$/, '').split(sep).join(':')
    const firstLine = body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
    cmds.push({
      name,
      description: meta.description || firstLine || name,
      body,
      args: detectArgs(body, meta['argument-hint'] ?? ''),
      source: 'file',
    })
  }
  return cmds
}

// Discover Claude Code custom commands for a cwd: user (~/.claude/commands) then
// project (<cwd>/.claude/commands), with project winning on name collision.
export function discoverClaudeCommands(cwd: string, home = homedir()): AgentCommand[] {
  const byName = new Map<string, AgentCommand>()
  for (const c of readDir(join(home, '.claude', 'commands'))) byName.set(c.name, c)
  for (const c of readDir(join(cwd, '.claude', 'commands'))) byName.set(c.name, c)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
