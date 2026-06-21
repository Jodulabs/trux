import { describe, expect, it } from 'vitest'
import { parseDiff } from '../src/diff'

const SAMPLE = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,6 @@
 import x from 'x'
-const a = 1
+const a = 2
+const b = 3
 export { a }
`

describe('parseDiff', () => {
  it('counts added and deleted lines', () => {
    const r = parseDiff(SAMPLE)
    expect(r.added).toBe(2)
    expect(r.deleted).toBe(1)
  })

  it('produces one hunk with the right header', () => {
    const r = parseDiff(SAMPLE)
    expect(r.hunks).toHaveLength(1)
    expect(r.hunks[0].header).toMatch(/^@@ -1,5 \+1,6 @@/)
  })

  it('classifies lines correctly', () => {
    const { lines } = parseDiff(SAMPLE).hunks[0]
    expect(lines.find((l) => l.kind === 'del')?.text).toBe('const a = 1')
    expect(lines.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual([
      'const a = 2',
      'const b = 3',
    ])
    expect(lines.filter((l) => l.kind === 'ctx')).toHaveLength(2)
  })

  it('tracks line numbers', () => {
    const { lines } = parseDiff(SAMPLE).hunks[0]
    const del = lines.find((l) => l.kind === 'del')!
    expect(del.oldLine).toBe(2)
    expect(del.newLine).toBeUndefined()
    const adds = lines.filter((l) => l.kind === 'add')
    expect(adds[0].newLine).toBe(2)
    expect(adds[0].oldLine).toBeUndefined()
  })

  it('returns empty result for empty input', () => {
    const r = parseDiff('')
    expect(r.hunks).toHaveLength(0)
    expect(r.added).toBe(0)
    expect(r.deleted).toBe(0)
  })

  it('handles multiple hunks', () => {
    const multi = `@@ -1,2 +1,2 @@
-old1
+new1
 ctx
@@ -10,2 +10,2 @@
-old2
+new2
`
    const r = parseDiff(multi)
    expect(r.hunks).toHaveLength(2)
    expect(r.added).toBe(2)
    expect(r.deleted).toBe(2)
  })
})
