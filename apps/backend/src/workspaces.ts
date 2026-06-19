import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
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

// One Workspace per repo (the project), with that repo's own worktrees nested —
// so the picker is repo → worktree, never a flat dump of every repo's worktrees.
function repoWorkspace(repo: string): Workspace {
  return { name: basename(repo), root: repo, worktrees: worktreesOf(repo) }
}

// For each configured root:
//  - if the root is itself a git repo → one workspace for it;
//  - otherwise (a directory *of* repos, e.g. ~/code) → one workspace per git repo
//    one level down, so you pick a real project instead of a bare directory.
// A non-git root with no repos under it degrades to a single branchless entry.
export function listWorkspaces(roots: string[]): Workspace[] {
  return roots.flatMap((root) => {
    if (isGitRepo(root)) return [repoWorkspace(root)]
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
      return [{ name: basename(root), root, worktrees: [{ path: root, branch: null }] }]
    }
    return repos.map(repoWorkspace)
  })
}
