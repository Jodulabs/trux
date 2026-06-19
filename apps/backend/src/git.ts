import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isAbsolute, normalize } from 'node:path'

const exec = promisify(execFile)

export interface GitFileStatus {
  path: string
  // git porcelain status codes for the index (staged) and work tree columns.
  index: string
  work: string
  staged: boolean
}

export interface GitStatus {
  repo: true
  branch: string | null
  ahead: number
  behind: number
  dirty: boolean
  files: GitFileStatus[]
}

export type GitStatusResult = GitStatus | { repo: false }

export interface CommitResult {
  ok: boolean
  hash?: string
  error?: string
}

// Run git in `cwd`, capturing stdout. stderr is surfaced via the thrown error's
// message so callers can report a real reason (e.g. "nothing to commit").
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

// Reject a pathspec that could escape the repo (absolute, or climbing via ..).
// The phone is an untrusted-ish surface; a git op must stay inside the cwd.
export function isSafeRepoPath(path: string): boolean {
  if (path.length === 0) return false
  if (isAbsolute(path)) return false
  const norm = normalize(path)
  if (norm === '..' || norm.startsWith('../') || norm.startsWith('..\\')) return false
  return true
}

// Parse `git status --porcelain=v1 --branch` into a structured status. The first
// line is `## branch...tracking [ahead N, behind M]`; the rest are XY-prefixed files.
export function parseStatus(porcelain: string): Omit<GitStatus, 'repo'> {
  const lines = porcelain.split('\n')
  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const files: GitFileStatus[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      // "branch...remote [ahead 1, behind 2]" or "No commits yet on branch"
      const noCommits = /^No commits yet on (.+)$/.exec(head)
      if (noCommits) {
        branch = noCommits[1].trim()
        continue
      }
      branch = head.split(/\.{3}| /)[0] || null
      const a = /ahead (\d+)/.exec(head)
      const b = /behind (\d+)/.exec(head)
      if (a) ahead = Number(a[1])
      if (b) behind = Number(b[1])
      continue
    }
    if (line.length < 3) continue
    const index = line[0]
    const work = line[1]
    let path = line.slice(3)
    // Renames are "old -> new"; surface the new path.
    const arrow = path.indexOf(' -> ')
    if (arrow >= 0) path = path.slice(arrow + 4)
    files.push({ path, index, work, staged: index !== ' ' && index !== '?' })
  }
  return { branch, ahead, behind, dirty: files.length > 0, files }
}

export async function gitStatus(cwd: string): Promise<GitStatusResult> {
  try {
    const out = await git(cwd, ['status', '--porcelain=v1', '--branch'])
    return { repo: true, ...parseStatus(out) }
  } catch {
    return { repo: false }
  }
}

export async function gitDiff(
  cwd: string,
  opts?: { path?: string; staged?: boolean },
): Promise<string> {
  const args = ['diff']
  if (opts?.staged) args.push('--staged')
  if (opts?.path) {
    if (!isSafeRepoPath(opts.path)) throw new Error('unsafe path')
    args.push('--', opts.path)
  }
  try {
    return await git(cwd, args)
  } catch {
    return ''
  }
}

export async function gitStage(cwd: string, path: string): Promise<void> {
  if (!isSafeRepoPath(path)) throw new Error('unsafe path')
  await git(cwd, ['add', '--', path])
}

export async function gitUnstage(cwd: string, path: string): Promise<void> {
  if (!isSafeRepoPath(path)) throw new Error('unsafe path')
  await git(cwd, ['restore', '--staged', '--', path])
}

// Commit the staged index. No -a, no path args — the user stages explicitly, so a
// commit can never sweep in unintended work.
export async function gitCommit(cwd: string, message: string): Promise<CommitResult> {
  if (message.trim().length === 0) return { ok: false, error: 'empty commit message' }
  try {
    await git(cwd, ['commit', '-m', message])
    const hash = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
    return { ok: true, hash }
  } catch (err) {
    const msg = (err as { stderr?: string; message?: string }).stderr?.trim() ||
      (err as Error).message ||
      'commit failed'
    return { ok: false, error: msg }
  }
}
