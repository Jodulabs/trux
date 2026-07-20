import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { allowedRoots, listDirs, breadcrumbSegments } from '../src/fs-browse'

describe('fs-browse', () => {
  it('lists directories under an allowed root and rejects escape', () => {
    const home = mkdtempSync(join(tmpdir(), 'trux-fs-'))
    try {
      mkdirSync(join(home, 'code'))
      mkdirSync(join(home, 'code', 'app'))
      writeFileSync(join(home, 'code', 'readme.txt'), 'x')
      const roots = allowedRoots([], home)
      expect(roots).toEqual([home])

      const listing = listDirs(join(home, 'code'), [], home)
      expect(listing.path).toBe(join(home, 'code'))
      expect(listing.entries.map((e) => e.name)).toEqual(['app'])
      expect(listing.parent).toBe(home)

      expect(() => listDirs('/tmp', [], home)).toThrow(/outside allowed/)
      expect(() => listDirs(join(home, '..', '..'), [], home)).toThrow(/outside allowed/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('builds breadcrumb segments from root', () => {
    const home = '/home/me'
    const segs = breadcrumbSegments('/home/me/code/app', [home])
    expect(segs).toEqual([
      { name: 'me', path: '/home/me' },
      { name: 'code', path: '/home/me/code' },
      { name: 'app', path: '/home/me/code/app' },
    ])
  })
})
