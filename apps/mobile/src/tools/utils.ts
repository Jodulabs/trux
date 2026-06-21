// Vendored utilities from happy (slopus/happy, MIT), re-skinned for trux.
// Only the functions the tool-view substrate actually calls are included.
// Source: vendor/happy/packages/happy-app/sources/utils/

// --- trimIdent ---
// Source: vendor/happy/packages/happy-app/sources/utils/trimIdent.ts
export function trimIdent(text: string): string {
  const lines = text.split('\n')
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  const minSpaces = lines.reduce((min, line) => {
    if (line.trim() === '') return min
    const leadingSpaces = line.match(/^\s*/)![0].length
    return Math.min(min, leadingSpaces)
  }, Infinity)
  const trimmedLines = lines.map((line) => line.slice(minSpaces))
  return trimmedLines.join('\n')
}

// --- parseToolUseError ---
// Source: vendor/happy/packages/happy-app/sources/utils/toolErrorParser.ts
export function parseToolUseError(message: string): {
  isToolUseError: boolean
  errorMessage: string | null
} {
  if (typeof message !== 'string') return { isToolUseError: false, errorMessage: null }
  const regex = /<tool_use_error>(.*?)<\/tool_use_error>/s
  const match = message.match(regex)
  if (match) return { isToolUseError: true, errorMessage: match[1] ? match[1].trim() : '' }
  return { isToolUseError: false, errorMessage: null }
}

// --- resolvePath ---
// Simplified from happy's pathUtils — trux doesn't carry a home-dir metadata
// field, so we just return the path as-is (strip cwd prefix if present).
// Source: vendor/happy/packages/happy-app/sources/utils/pathUtils.ts
export function resolvePath(path: string, metadata: { path?: string } | null): string {
  if (!path) return path
  const cwd = metadata?.path
  if (cwd && path.startsWith(cwd + '/')) return path.slice(cwd.length + 1)
  return path
}
