import { describe, expect, it } from 'vitest'
import { toolSummary } from '../src/tools'

describe('toolSummary', () => {
  it('shows the command for Bash', () => {
    expect(toolSummary('Bash', { command: 'pytest -x' })).toBe('pytest -x')
  })

  it('shows the file path for file tools', () => {
    expect(toolSummary('Read', { file_path: '/repo/app.ts' })).toBe('/repo/app.ts')
    expect(toolSummary('Edit', { file_path: '/repo/x.ts', old_string: 'a' })).toBe('/repo/x.ts')
  })

  it('shows pattern + location for Grep/Glob', () => {
    expect(toolSummary('Grep', { pattern: 'TODO', path: 'src' })).toBe('TODO in src')
    expect(toolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })

  it('summarises TodoWrite by count', () => {
    expect(toolSummary('TodoWrite', { todos: [1, 2, 3] })).toBe('3 todos')
  })

  it('falls back to the first string field for unknown tools', () => {
    expect(toolSummary('SomethingNew', { foo: 42, bar: 'hello' })).toBe('hello')
  })

  it('returns empty string for non-object input', () => {
    expect(toolSummary('Bash', null)).toBe('')
    expect(toolSummary('Bash', 'not an object')).toBe('')
  })
})
