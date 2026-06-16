// Thin localStorage wrapper for saved text snippets.
const KEY = 'trux_snippets'

export interface Snippet {
  id: string
  label: string
  text: string
}

export function loadSnippets(): Snippet[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Snippet[]
  } catch {
    return []
  }
}

function saveAll(snippets: Snippet[]): void {
  localStorage.setItem(KEY, JSON.stringify(snippets))
}

export function addSnippet(text: string): Snippet {
  const snippets = loadSnippets()
  const snippet: Snippet = {
    id: `snip_${Date.now()}`,
    label: text.slice(0, 40) + (text.length > 40 ? '…' : ''),
    text,
  }
  saveAll([snippet, ...snippets])
  return snippet
}

export function deleteSnippet(id: string): void {
  saveAll(loadSnippets().filter((s) => s.id !== id))
}
