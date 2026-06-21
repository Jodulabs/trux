import type { Storage } from '../src/ports'

// An in-memory Storage port for spine tests (no DOM/localStorage needed).
export function makeMemoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      m.set(k, v)
    },
    remove: (k) => {
      m.delete(k)
    },
  }
}
