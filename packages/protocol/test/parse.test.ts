import { describe, expect, it } from 'vitest'
import { parseClientMessage } from '../src/parse'

describe('parseClientMessage', () => {
  it('parses a valid auth message', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'auth', token: 'abc' }))).toEqual({
      type: 'auth',
      token: 'abc',
    })
  })

  it('parses an interrupt message', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'interrupt' }))).toEqual({ type: 'interrupt' })
  })

  it('parses a user_message and drops unknown extra fields', () => {
    const out = parseClientMessage(JSON.stringify({ type: 'user_message', text: 'hi', extra: 1 }))
    expect(out).toEqual({ type: 'user_message', text: 'hi' })
  })

  it('keeps client_message_id on a user_message when present', () => {
    const out = parseClientMessage(JSON.stringify({ type: 'user_message', text: 'hi', client_message_id: 'm1' }))
    expect(out).toEqual({ type: 'user_message', text: 'hi', client_message_id: 'm1' })
  })

  it('parses a resume message with an integer since_seq', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'resume', since_seq: 7 }))).toEqual({
      type: 'resume',
      since_seq: 7,
    })
  })

  it('rejects a resume message with a non-integer since_seq', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'resume', since_seq: 'x' }))).toBeNull()
  })

  it('parses an approval_response with a valid decision', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'approval_response', request_id: 'ap_1', decision: 'allow' })),
    ).toEqual({ type: 'approval_response', request_id: 'ap_1', decision: 'allow', note: null })
  })

  it('rejects an unknown type', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'nope' }))).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseClientMessage('{not json')).toBeNull()
  })

  it('rejects auth without a string token', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'auth' }))).toBeNull()
  })

  it('rejects approval_response with an invalid decision', () => {
    expect(
      parseClientMessage(JSON.stringify({ type: 'approval_response', request_id: 'ap_1', decision: 'maybe' })),
    ).toBeNull()
  })

  it('parses graduated decision scopes', () => {
    for (const decision of ['allow_edits', 'allow_command'] as const) {
      expect(
        parseClientMessage(JSON.stringify({ type: 'approval_response', request_id: 'ap_1', decision })),
      ).toEqual({ type: 'approval_response', request_id: 'ap_1', decision, note: null })
    }
  })
})
