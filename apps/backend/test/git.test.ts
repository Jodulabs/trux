import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  gitCommit,
  gitDiff,
  gitStage,
  gitStatus,
  gitUnstage,
  isSafeRepoPath,
  parseStatus,
} from '../src/git'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// A fresh git repo with a deterministic identity and one initial commit.
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'trux-git-'))
  dirs.push(dir)
  const g = (args: string[]): void => {
    execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  }
  g(['init', '-q'])
  g(['config', 'user.email', 'test@trux'])
  g(['config', 'user.name', 'Trux Test'])
  g(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'README.md'), 'hello\n')
  g(['add', '-A'])
  g(['commit', '-q', '-m', 'init'])
  return dir
}

describe('isSafeRepoPath', () => {
  it('rejects absolute paths and parent escapes', () => {
    expect(isSafeRepoPath('src/a.ts')).toBe(true)
    expect(isSafeRepoPath('/etc/passwd')).toBe(false)
    expect(isSafeRepoPath('../secret')).toBe(false)
    expect(isSafeRepoPath('..')).toBe(false)
    expect(isSafeRepoPath('')).toBe(false)
  })
})

describe('parseStatus', () => {
  it('parses branch, ahead/behind, and file rows', () => {
    const out = [
      '## main...origin/main [ahead 2, behind 1]',
      ' M src/changed.ts',
      'A  src/added.ts',
      '?? new.txt',
      '',
    ].join('\n')
    const status = parseStatus(out)
    expect(status.branch).toBe('main')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(1)
    expect(status.dirty).toBe(true)
    expect(status.files).toEqual([
      { path: 'src/changed.ts', index: ' ', work: 'M', staged: false },
      { path: 'src/added.ts', index: 'A', work: ' ', staged: true },
      { path: 'new.txt', index: '?', work: '?', staged: false },
    ])
  })

  it('handles a fresh repo with no commits', () => {
    const status = parseStatus('## No commits yet on main\n?? a.txt\n')
    expect(status.branch).toBe('main')
    expect(status.ahead).toBe(0)
  })
})

describe('git ops on a real repo', () => {
  it('reports a clean repo, then a dirty one', async () => {
    const dir = initRepo()
    const clean = await gitStatus(dir)
    expect(clean).toMatchObject({ repo: true, dirty: false })
    writeFileSync(join(dir, 'README.md'), 'hello world\n')
    const dirty = await gitStatus(dir)
    expect(dirty).toMatchObject({ repo: true, dirty: true })
    if (dirty.repo) expect(dirty.files.map((f) => f.path)).toContain('README.md')
  })

  it('non-repo dir returns {repo:false}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trux-nogit-'))
    dirs.push(dir)
    expect(await gitStatus(dir)).toEqual({ repo: false })
  })

  it('stages, diffs staged, commits, and goes clean', async () => {
    const dir = initRepo()
    writeFileSync(join(dir, 'README.md'), 'changed\n')
    const unstagedDiff = await gitDiff(dir, { path: 'README.md' })
    expect(unstagedDiff).toContain('+changed')

    await gitStage(dir, 'README.md')
    const stagedDiff = await gitDiff(dir, { path: 'README.md', staged: true })
    expect(stagedDiff).toContain('+changed')

    const status = await gitStatus(dir)
    if (status.repo) expect(status.files.find((f) => f.path === 'README.md')?.staged).toBe(true)

    const res = await gitCommit(dir, 'update readme')
    expect(res.ok).toBe(true)
    expect(res.hash).toMatch(/^[0-9a-f]+$/)
    expect(await gitStatus(dir)).toMatchObject({ dirty: false })
  })

  it('unstages a staged file', async () => {
    const dir = initRepo()
    // Modify a tracked file so its staged/unstaged state is unambiguous (a brand
    // new file collapses to its untracked dir on unstage, which is harder to assert).
    writeFileSync(join(dir, 'README.md'), 'modified\n')
    await gitStage(dir, 'README.md')
    const staged = await gitStatus(dir)
    if (staged.repo) expect(staged.files.find((f) => f.path === 'README.md')?.staged).toBe(true)
    await gitUnstage(dir, 'README.md')
    const status = await gitStatus(dir)
    if (status.repo) expect(status.files.find((f) => f.path === 'README.md')?.staged).toBe(false)
  })

  it('refuses an empty commit message', async () => {
    const dir = initRepo()
    expect(await gitCommit(dir, '   ')).toEqual({ ok: false, error: 'empty commit message' })
  })

  it('reports an error when there is nothing staged to commit', async () => {
    const dir = initRepo()
    const res = await gitCommit(dir, 'nothing here')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('rejects an unsafe path for stage/diff', async () => {
    const dir = initRepo()
    await expect(gitStage(dir, '../escape')).rejects.toThrow('unsafe path')
    await expect(gitDiff(dir, { path: '/etc/passwd' })).rejects.toThrow('unsafe path')
  })
})
