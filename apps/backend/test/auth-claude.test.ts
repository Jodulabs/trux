import { describe, it, expect } from 'vitest'
import { parseClaudeSetupOutput, parseClaudeStatus } from '../src/auth-provider'

describe('parseClaudeSetupOutput', () => {
  it('extracts the sign-in URL', () => {
    expect(parseClaudeSetupOutput('Visit https://claude.ai/oauth/authorize?x=1 to continue')).toEqual({
      verifyUrl: 'https://claude.ai/oauth/authorize?x=1',
    })
  })
  it('returns null before a URL appears', () => {
    expect(parseClaudeSetupOutput('Starting…')).toBeNull()
  })
})

describe('parseClaudeStatus', () => {
  it('maps loggedIn JSON to connected', () => {
    expect(parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai"}')).toBe('connected')
  })
  it('maps logged-out JSON to disconnected', () => {
    expect(parseClaudeStatus('{"loggedIn":false}')).toBe('disconnected')
  })
})
