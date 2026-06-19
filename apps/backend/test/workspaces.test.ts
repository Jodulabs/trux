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

function initRepo(dir: string): void {
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'])
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init'])
}

describe('listWorkspaces', () => {
  it('returns one workspace per repo, named by its directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-ws-'))
    dirs.push(root)
    initRepo(root)
    const [ws] = listWorkspaces([root])
    expect(ws?.root).toBe(root)
    expect(ws?.name).toBe(root.split('/').pop())
    expect(ws?.worktrees[0]?.branch).toBe('main')
  })

  it('degrades a non-git directory with no repos to a single branchless entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-plain-'))
    dirs.push(root)
    expect(listWorkspaces([root])).toEqual([
      { name: root.split('/').pop(), root, worktrees: [{ path: root, branch: null }] },
    ])
  })

  it('surfaces each git repo under a non-git root as its own workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-code-'))
    dirs.push(root)
    const repoA = join(root, 'alpha')
    const repoB = join(root, 'beta')
    for (const r of [repoA, repoB]) {
      mkdirSync(r)
      initRepo(r)
    }
    mkdirSync(join(root, 'notarepo')) // ignored — no .git
    const list = listWorkspaces([root])
    expect(list.map((w) => w.name).sort()).toEqual(['alpha', 'beta'])
    expect(list.map((w) => w.root).sort()).toEqual([repoA, repoB])
    // Each repo keeps only its OWN worktrees — they are never flattened together.
    for (const ws of list) expect(ws.worktrees).toEqual([{ path: ws.root, branch: 'main' }])
  })

  it("nests a repo's linked worktrees under that repo, not as siblings", () => {
    const root = mkdtempSync(join(tmpdir(), 'trux-wt-'))
    dirs.push(root)
    const repo = join(root, 'proj')
    mkdirSync(repo)
    initRepo(repo)
    const wt = join(repo, '.worktrees', 'feat')
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'feat', wt])
    const list = listWorkspaces([root])
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('proj')
    expect(list[0]?.worktrees.map((w) => w.branch).sort()).toEqual(['feat', 'main'])
  })
})
