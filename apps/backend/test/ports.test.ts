import { describe, expect, it } from 'vitest'
import { detectPort } from '../src/ports'

describe('detectPort', () => {
  it('finds a localhost port from a vite-style line', () => {
    expect(detectPort('  ➜  Local:   http://localhost:5173/')).toBe(5173)
  })
  it('finds a 127.0.0.1 port', () => {
    expect(detectPort('listening on http://127.0.0.1:4317')).toBe(4317)
  })
  it('finds a bare localhost:port', () => {
    expect(detectPort('server up at localhost:3000 now')).toBe(3000)
  })
  it('returns null when no port is present', () => {
    expect(detectPort('nothing here')).toBeNull()
  })
  it('returns the first match', () => {
    expect(detectPort('a localhost:3000 b localhost:4000')).toBe(3000)
  })
})
