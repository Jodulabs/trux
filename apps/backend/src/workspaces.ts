import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

// git worktrees of a repo; stderr is silenced so a non-repo never leaks
// "fatal: not a git repository" into the server log.
function worktreesOf(repo: string): Worktree[] {
  try {
    const porcelain = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const worktrees = parseWorktrees(porcelain)
    return worktrees.length > 0 ? worktrees : [{ path: repo, branch: null }]
  } catch {
    return [{ path: repo, branch: null }]
  }
}

// For each configured root:
//  - if the root is itself a git repo → list its worktrees;
//  - otherwise (a directory *of* repos, e.g. ~/code) → surface the git repos one
//    level down, so you pick a real repo instead of a bare non-repo directory.
export function listWorkspaces(roots: string[]): Workspace[] {
  return roots.map((root) => {
    if (isGitRepo(root)) {
      return { root, worktrees: worktreesOf(root) }
    }
    let repos: string[] = []
    try {
      repos = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && isGitRepo(join(root, d.name)))
        .map((d) => join(root, d.name))
        .sort()
    } catch {
      repos = []
    }
    if (repos.length === 0) {
      return { root, worktrees: [{ path: root, branch: null }] }
    }
    return { root, worktrees: repos.flatMap(worktreesOf) }
  })
}
