import { describe, it, expect } from 'vitest'
import { parseCodexDeviceOutput, parseCodexStatus } from '../src/auth-provider'

describe('parseCodexDeviceOutput', () => {
  it('extracts the verify URL and user code', () => {
    const out = 'To authenticate, visit https://chatgpt.com/device and enter code: WXYZ-1234\n'
    expect(parseCodexDeviceOutput(out)).toEqual({ verifyUrl: 'https://chatgpt.com/device', userCode: 'WXYZ-1234' })
  })
  it('returns the URL with a null code when no code is present', () => {
    expect(parseCodexDeviceOutput('Open https://example.com/auth to continue')).toEqual({
      verifyUrl: 'https://example.com/auth',
      userCode: null,
    })
  })
  it('returns null before any URL appears', () => {
    expect(parseCodexDeviceOutput('Starting device authorization…')).toBeNull()
  })
})

describe('parseCodexStatus', () => {
  it('maps a logged-in line to connected', () => {
    expect(parseCodexStatus('Logged in using ChatGPT')).toBe('connected')
  })
  it('maps a not-logged-in line to disconnected', () => {
    expect(parseCodexStatus('Not logged in')).toBe('disconnected')
  })
})
