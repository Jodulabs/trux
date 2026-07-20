import { readdirSync, realpathSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

export interface DirEntry {
  name: string
  path: string
}

export interface DirListing {
  path: string
  parent: string | null
  entries: DirEntry[]
}

/** Unique absolute roots the browser may enter (home + configured workspaces). */
export function allowedRoots(workspaceRoots: string[], home: string = homedir()): string[] {
  const raw = [home, ...workspaceRoots].filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    try {
      const abs = realpathSync(resolve(r))
      if (seen.has(abs)) continue
      seen.add(abs)
      out.push(abs)
    } catch {
      // skip missing roots
    }
  }
  return out
}

function isUnderRoot(absPath: string, roots: string[]): boolean {
  const prefix = absPath.endsWith(sep) ? absPath : absPath + sep
  return roots.some((root) => {
    if (absPath === root) return true
    const rootPrefix = root.endsWith(sep) ? root : root + sep
    return prefix.startsWith(rootPrefix) || absPath.startsWith(rootPrefix)
  })
}

export function listDirs(
  requestedPath: string | undefined,
  workspaceRoots: string[],
  home: string = homedir(),
): DirListing {
  const roots = allowedRoots(workspaceRoots, home)
  if (roots.length === 0) {
    throw Object.assign(new Error('no browse roots configured'), { statusCode: 400 })
  }

  const target = requestedPath?.trim() ? resolve(requestedPath) : roots[0]!
  let abs: string
  try {
    abs = existsSync(target) ? realpathSync(target) : resolve(target)
  } catch {
    throw Object.assign(new Error('path not found'), { statusCode: 404 })
  }

  if (!isUnderRoot(abs, roots)) {
    throw Object.assign(new Error('path outside allowed roots'), { statusCode: 403 })
  }

  let st
  try {
    st = statSync(abs)
  } catch {
    throw Object.assign(new Error('path not found'), { statusCode: 404 })
  }
  if (!st.isDirectory()) {
    throw Object.assign(new Error('not a directory'), { statusCode: 400 })
  }

  let names: string[] = []
  try {
    names = readdirSync(abs)
  } catch {
    throw Object.assign(new Error('cannot read directory'), { statusCode: 500 })
  }

  const entries: DirEntry[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const child = join(abs, name)
    try {
      if (statSync(child).isDirectory()) entries.push({ name, path: child })
    } catch {
      // skip unreadable
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))

  const parentDir = dirname(abs)
  const parent = parentDir !== abs && isUnderRoot(parentDir, roots) ? parentDir : null

  return { path: abs, parent, entries }
}

export function breadcrumbSegments(path: string, roots: string[]): { name: string; path: string }[] {
  const root = roots.find((r) => path === r || path.startsWith(r + sep)) ?? roots[0]
  if (!root) return [{ name: basename(path) || path, path }]
  const rel = path === root ? '' : path.slice(root.length).replace(/^\//, '')
  const parts = rel ? rel.split('/') : []
  const segs: { name: string; path: string }[] = [{ name: basename(root) || root, path: root }]
  let cur = root
  for (const p of parts) {
    cur = join(cur, p)
    segs.push({ name: p, path: cur })
  }
  return segs
}
