import { execFileSync } from 'node:child_process'
import type { Workspace, Worktree } from '@trux/protocol'

// Parse `git worktree list --porcelain` into worktree records.
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = []
  let path: string | null = null
  let branch: string | null = null
  const flush = (): void => {
    if (path) out.push({ path, branch })
    path = null
    branch = null
  }
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).replace('refs/heads/', '')
    } else if (line === '') {
      flush()
    }
  }
  flush()
  return out
}

// For each configured root, list its git worktrees; a non-repo degrades to itself.
export function listWorkspaces(roots: string[]): Workspace[] {
  return roots.map((root) => {
    try {
      const porcelain = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], {
        encoding: 'utf8',
      })
      const worktrees = parseWorktrees(porcelain)
      return { root, worktrees: worktrees.length > 0 ? worktrees : [{ path: root, branch: null }] }
    } catch {
      return { root, worktrees: [{ path: root, branch: null }] }
    }
  })
}
