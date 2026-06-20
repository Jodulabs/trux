import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverClaudeCommands } from '../src/commands'

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'trux-cmd-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function writeCmd(root: string, rel: string, content: string): void {
  const full = join(root, '.claude', 'commands', rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('discoverClaudeCommands', () => {
  it('parses description, strips frontmatter, and detects $ARGUMENTS', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(cwd, 'review.md', '---\ndescription: Review code\nargument-hint: a PR number\n---\nReview $ARGUMENTS please')
    const cmds = discoverClaudeCommands(cwd, home)
    const review = cmds.find((c) => c.name === 'review')
    expect(review?.description).toBe('Review code')
    expect(review?.body).toBe('Review $ARGUMENTS please')
    expect(review?.args).toEqual([{ name: 'ARGUMENTS', label: 'a PR number', required: true }])
  })

  it('namespaces subfolders with a colon', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(cwd, join('frontend', 'component.md'), 'Make a $1 component')
    const cmds = discoverClaudeCommands(cwd, home)
    const cmd = cmds.find((c) => c.name === 'frontend:component')
    expect(cmd?.args).toEqual([{ name: '1', label: 'Argument 1', required: true }])
  })

  it('falls back to the first non-empty line for description', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(cwd, 'ship.md', '\nShip it to prod\nmore detail')
    expect(discoverClaudeCommands(cwd, home).find((c) => c.name === 'ship')?.description).toBe('Ship it to prod')
  })

  it('lets a project command override a same-named user command', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(home, 'review.md', 'user version')
    writeCmd(cwd, 'review.md', 'project version')
    expect(discoverClaudeCommands(cwd, home).find((c) => c.name === 'review')?.body).toBe('project version')
  })

  it('returns [] when no commands dir exists', () => {
    expect(discoverClaudeCommands(tmp(), tmp())).toEqual([])
  })
})
