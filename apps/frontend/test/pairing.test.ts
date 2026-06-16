import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { consumePairingToken } from '../src/pairing'

afterEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('consumePairingToken', () => {
  it('stores the token from the URL fragment and clears the fragment', () => {
    window.history.replaceState(null, '', '/#token=abc123')
    const result = consumePairingToken()
    expect(result).toBe('abc123')
    expect(localStorage.getItem('trux_token')).toBe('abc123')
    expect(window.location.hash).toBe('')
  })

  it('decodes a URL-encoded token', () => {
    window.history.replaceState(null, '', '/#token=a%2Bb%2Fc')
    const result = consumePairingToken()
    expect(result).toBe('a+b/c')
    expect(localStorage.getItem('trux_token')).toBe('a+b/c')
  })

  it('returns null and leaves storage untouched when no token fragment is present', () => {
    window.history.replaceState(null, '', '/#section')
    const result = consumePairingToken()
    expect(result).toBeNull()
    expect(localStorage.getItem('trux_token')).toBeNull()
  })

  it('returns null when there is no fragment at all', () => {
    const result = consumePairingToken()
    expect(result).toBeNull()
    expect(localStorage.getItem('trux_token')).toBeNull()
  })
})
