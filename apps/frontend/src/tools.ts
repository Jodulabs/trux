// A one-line, human-readable summary of a tool call's input, shown next to the
// tool name in the transcript so you can see *what* ran without expanding.
export function toolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')

  switch (name) {
    case 'Bash':
      return str(o.command)
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return str(o.file_path) || str(o.path) || str(o.notebook_path)
    case 'Glob':
      return str(o.pattern) + (o.path ? ` in ${str(o.path)}` : '')
    case 'Grep':
      return str(o.pattern) + (o.path ? ` in ${str(o.path)}` : '')
    case 'WebFetch':
      return str(o.url)
    case 'WebSearch':
      return str(o.query)
    case 'Task':
      return str(o.description)
    case 'TodoWrite':
      return Array.isArray(o.todos) ? `${o.todos.length} todos` : 'todos'
    default: {
      // Fall back to the first non-empty string field.
      const first = Object.values(o).find((v) => typeof v === 'string' && v.length > 0)
      return typeof first === 'string' ? first : ''
    }
  }
}
