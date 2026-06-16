import { describe, expect, it } from 'vitest'
import { OpencodeMapper, type OcEvent } from '../../src/adapter/opencode-map'

const SID = 's1'
function textPart(over: Record<string, unknown> = {}): OcEvent {
  return { type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', sessionID: SID, text: 'Hello', ...over } } }
}

describe('OpencodeMapper', () => {
  it('maps a text delta then a finalized text', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'message.part.updated', properties: { delta: 'Hel', part: { type: 'text', id: 'p1', sessionID: SID, text: 'Hel' } } })).toEqual([
      { type: 'text_delta', text: 'Hel' },
    ])
    expect(m.map({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p1', sessionID: SID, text: 'Hello', time: { end: 2 } } } })).toEqual([
      { type: 'text', text: 'Hello' },
    ])
  })

  it('finalizes a text part only once', () => {
    const m = new OpencodeMapper(SID)
    const ev = textPart({ time: { end: 1 } })
    expect(m.map(ev)).toEqual([{ type: 'text', text: 'Hello' }])
    expect(m.map(ev)).toEqual([])
  })

  it('emits tool_call on running then tool_result on completed, once each', () => {
    const m = new OpencodeMapper(SID)
    const running: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c1', tool: 'bash', state: { status: 'running', input: { command: 'ls' } } } } }
    const completed: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c1', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb' } } } }
    expect(m.map(running)).toEqual([{ type: 'tool_call', tool_id: 'c1', name: 'bash', input: { command: 'ls' } }])
    expect(m.map(running)).toEqual([])
    expect(m.map(completed)).toEqual([{ type: 'tool_result', tool_id: 'c1', status: 'ok', output: 'a\nb' }])
    expect(m.map(completed)).toEqual([])
  })

  it('emits tool_call+tool_result for a tool that goes straight to completed', () => {
    const m = new OpencodeMapper(SID)
    const completed: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c2', tool: 'read', state: { status: 'completed', input: { path: 'x' }, output: 'ok' } } } }
    expect(m.map(completed)).toEqual([
      { type: 'tool_call', tool_id: 'c2', name: 'read', input: { path: 'x' } },
      { type: 'tool_result', tool_id: 'c2', status: 'ok', output: 'ok' },
    ])
  })

  it('maps an errored tool to a tool_result with status error', () => {
    const m = new OpencodeMapper(SID)
    const errored: OcEvent = { type: 'message.part.updated', properties: { part: { type: 'tool', id: 't', sessionID: SID, callID: 'c3', tool: 'bash', state: { status: 'error', input: {}, error: 'boom' } } } }
    expect(m.map(errored)).toEqual([
      { type: 'tool_call', tool_id: 'c3', name: 'bash', input: {} },
      { type: 'tool_result', tool_id: 'c3', status: 'error', output: 'boom' },
    ])
  })

  it('maps a permission to an approval_request', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'permission.updated', properties: { id: 'perm1', type: 'bash', sessionID: SID, title: 'Run ls', metadata: { command: 'ls' } } })).toEqual([
      { type: 'approval_request', request_id: 'perm1', tool: 'bash', input: { command: 'ls' }, explanation: 'Run ls' },
    ])
  })

  it('maps session.idle to turn_complete and session.error to error', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'session.idle', properties: { sessionID: SID } })).toEqual([{ type: 'turn_complete', cost: null }])
    expect(m.map({ type: 'session.error', properties: { sessionID: SID, error: { message: 'nope' } } })).toEqual([
      { type: 'error', message: 'nope', recoverable: true },
    ])
  })

  it('ignores events for a different session', () => {
    const m = new OpencodeMapper(SID)
    expect(m.map({ type: 'message.part.updated', properties: { delta: 'x', part: { type: 'text', id: 'p', sessionID: 'other', text: 'x' } } })).toEqual([])
    expect(m.map({ type: 'session.idle', properties: { sessionID: 'other' } })).toEqual([])
  })
})
