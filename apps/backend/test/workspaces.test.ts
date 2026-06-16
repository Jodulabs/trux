import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorkspaces, parseWorktrees } from '../src/workspaces'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('parseWorktrees', () => {
  it('parses porcelain output into path + branch', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/feat',
      'HEAD def456',
      'branch refs/heads/feat',
      '',
    ].join('\n')
    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/.worktrees/feat', branch: 'feat' },
    ])
  })

  it('reports a detached worktree branch as null', () => {
    const porcelain = ['worktree /repo', 'HEAD abc123', 'detached', ''].join('\n')
    expect(parseWorktrees(porcelain)).toEqual([{ path: '/repo', branch: null }])
  })
})

describe('listWorkspaces', () => {
  it('enumerates worktrees for a real git repo', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-ws-'))
    dirs.push(root)
    execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'])
    execFileSync('git', ['-C', root, 'config', 'user.email', 't@t'])
    execFileSync('git', ['-C', root, 'config', 'user.name', 't'])
    execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init'])
    const [ws] = listWorkspaces([root])
    expect(ws?.root).toBe(root)
    expect(ws?.worktrees[0]?.branch).toBe('main')
  })

  it('degrades a non-git directory with no repos to a single branchless entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-plain-'))
    dirs.push(root)
    expect(listWorkspaces([root])).toEqual([{ root, worktrees: [{ path: root, branch: null }] }])
  })

  it('surfaces git repos one level under a non-git root', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-code-'))
    dirs.push(root)
    const repoA = join(root, 'alpha')
    const repoB = join(root, 'beta')
    for (const r of [repoA, repoB]) {
      mkdirSync(r)
      execFileSync('git', ['-C', r, 'init', '-q', '-b', 'main'])
      execFileSync('git', ['-C', r, 'config', 'user.email', 't@t'])
      execFileSync('git', ['-C', r, 'config', 'user.name', 't'])
      execFileSync('git', ['-C', r, 'commit', '-q', '--allow-empty', '-m', 'init'])
    }
    mkdirSync(join(root, 'notarepo')) // ignored — no .git
    const [ws] = listWorkspaces([root])
    expect(ws?.root).toBe(root)
    expect(ws?.worktrees.map((w) => w.path).sort()).toEqual([repoA, repoB])
  })
})
