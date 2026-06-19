export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** line number in the old file (ctx/del lines); undefined for add/hunk */
  oldLine?: number
  /** line number in the new file (ctx/add lines); undefined for del/hunk */
  newLine?: number
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface ParsedDiff {
  hunks: DiffHunk[]
  /** total lines added across all hunks */
  added: number
  /** total lines deleted across all hunks */
  deleted: number
}

// Parse a unified diff string into structured hunks. Ignores file header lines
// (--- / +++ / diff --git …) — callers already know which file they're showing.
export function parseDiff(raw: string): ParsedDiff {
  const lines = raw.split('\n')
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let added = 0
  let deleted = 0

  for (const raw of lines) {
    if (raw.startsWith('@@ ')) {
      // @@ -oldStart,oldCount +newStart,newCount @@ …
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      oldLine = m ? Number(m[1]) : 0
      newLine = m ? Number(m[2]) : 0
      current = { header: raw, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      current.lines.push({ kind: 'add', text: raw.slice(1), newLine: newLine++ })
      added++
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      current.lines.push({ kind: 'del', text: raw.slice(1), oldLine: oldLine++ })
      deleted++
    } else if (raw.startsWith(' ')) {
      current.lines.push({ kind: 'ctx', text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
    // Lines like "\\ No newline at end of file" are skipped.
  }

  return { hunks, added, deleted }
}
