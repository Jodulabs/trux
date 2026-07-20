import { describe, expect, it } from 'vitest'
import { PiMapper, type PiEvent, type PiMapState } from '../../src/adapter/pi-map'
import type { AdapterEvent } from '../../src/adapter/types'

function state(): PiMapState & { mapper: PiMapper } {
  const s: PiMapState & { mapper?: PiMapper } = { sessionId: null }
  s.mapper = new PiMapper(s)
  return s as PiMapState & { mapper: PiMapper }
}

describe('PiMapper', () => {
  it('session captures sessionId and emits nothing', () => {
    const s = state()
    expect(s.mapper.map({ type: 'session', session_id: 'pi-sess-1' })).toEqual([])
    expect(s.sessionId).toBe('pi-sess-1')
  })

  it('session also accepts `id` as the session-id field', () => {
    const s = state()
    expect(s.mapper.map({ type: 'session', id: 'pi-sess-2' })).toEqual([])
    expect(s.sessionId).toBe('pi-sess-2')
  })

  it('session with non-string id leaves state unchanged', () => {
    const s = state()
    s.sessionId = 'preexisting'
    expect(s.mapper.map({ type: 'session', session_id: 42 })).toEqual([])
    expect(s.sessionId).toBe('preexisting')
  })

  it('message_update with text_delta emits a text_delta', () => {
    const s = state()
    expect(s.mapper.map({ type: 'message_update', delta: { type: 'text_delta', text: 'Hel' } })).toEqual([
      { type: 'text_delta', text: 'Hel' },
    ])
  })

  it('message_update with non-text_delta delta emits nothing', () => {
    const s = state()
    expect(s.mapper.map({ type: 'message_update', delta: { type: 'tool_input_delta' } })).toEqual([])
  })

  it('message_end with top-level text emits final text', () => {
    const s = state()
    expect(s.mapper.map({ type: 'message_end', text: 'Hello' })).toEqual([
      { type: 'text', text: 'Hello' },
    ])
  })

  it('message_end with content array joins text blocks', () => {
    const s = state()
    const out = s.mapper.map({
      type: 'message_end',
      message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    })
    expect(out).toEqual([{ type: 'text', text: 'ab' }])
  })

  it('message_end with no text content emits nothing', () => {
    const s = state()
    expect(s.mapper.map({ type: 'message_end' })).toEqual([])
  })

  it('tool_execution_start emits tool_call', () => {
    const s = state()
    expect(s.mapper.map({
      type: 'tool_execution_start',
      tool_call_id: 'tc_1',
      tool_name: 'shell',
      input: { command: 'ls' },
    })).toEqual([
      { type: 'tool_call', tool_id: 'tc_1', name: 'shell', input: { command: 'ls' } },
    ])
  })

  it('tool_execution_start dedups by tool_call_id', () => {
    const s = state()
    s.mapper.map({ type: 'tool_execution_start', tool_call_id: 'tc_1', tool_name: 'shell', input: {} })
    expect(s.mapper.map({ type: 'tool_execution_start', tool_call_id: 'tc_1', tool_name: 'shell', input: {} })).toEqual([])
  })

  it('tool_execution_end emits tool_result ok on success', () => {
    const s = state()
    expect(s.mapper.map({
      type: 'tool_execution_end',
      tool_call_id: 'tc_1',
      status: 'ok',
      output: 'foo.ts\n',
    })).toEqual([
      { type: 'tool_result', tool_id: 'tc_1', status: 'ok', output: 'foo.ts\n' },
    ])
  })

  it('tool_execution_end maps non-zero exit_code to error status', () => {
    const s = state()
    expect(s.mapper.map({
      type: 'tool_execution_end',
      tool_call_id: 'tc_2',
      exit_code: 1,
      output: 'boom',
    })).toEqual([
      { type: 'tool_result', tool_id: 'tc_2', status: 'error', output: 'boom' },
    ])
  })

  it('tool_execution_end maps "failed" status to error', () => {
    const s = state()
    expect(s.mapper.map({
      type: 'tool_execution_end',
      tool_call_id: 'tc_3',
      status: 'failed',
      result: 'denied',
    })).toEqual([
      { type: 'tool_result', tool_id: 'tc_3', status: 'error', output: 'denied' },
    ])
  })

  it('tool_execution_end dedups by tool_call_id', () => {
    const s = state()
    s.mapper.map({ type: 'tool_execution_end', tool_call_id: 'tc_1', status: 'ok', output: 'x' })
    expect(s.mapper.map({ type: 'tool_execution_end', tool_call_id: 'tc_1', status: 'ok', output: 'y' })).toEqual([])
  })

  it('tool_execution_end with output object {text} extracts text', () => {
    const s = state()
    expect(s.mapper.map({
      type: 'tool_execution_end',
      tool_call_id: 'tc_4',
      status: 'ok',
      output: { text: 'hello' },
    })).toEqual([
      { type: 'tool_result', tool_id: 'tc_4', status: 'ok', output: 'hello' },
    ])
  })

  it('tool_execution_end with no output field yields empty string', () => {
    const s = state()
    expect(s.mapper.map({
      type: 'tool_execution_end',
      tool_call_id: 'tc_5',
      status: 'ok',
    })).toEqual([
      { type: 'tool_result', tool_id: 'tc_5', status: 'ok', output: '' },
    ])
  })

  it('tool events for empty id emit nothing', () => {
    const s = state()
    expect(s.mapper.map({ type: 'tool_execution_start', tool_name: 'shell' })).toEqual([])
    expect(s.mapper.map({ type: 'tool_execution_end', status: 'ok' })).toEqual([])
  })

  it('turn_end emits turn_complete with usage and cost', () => {
    const s = state()
    expect(s.mapper.map({
      type: 'turn_end',
      usage: { input_tokens: 12, output_tokens: 7 },
      cost_usd: 0.0012,
    })).toEqual([
      { type: 'turn_complete', usage: { input: 12, output: 7 }, cost: 0.0012 },
    ])
  })

  it('turn_end without usage/cost emits turn_complete with undefined usage and null cost', () => {
    const s = state()
    expect(s.mapper.map({ type: 'turn_end' })).toEqual([
      { type: 'turn_complete', usage: undefined, cost: null },
    ])
  })

  it('error emits a recoverable error', () => {
    const s = state()
    expect(s.mapper.map({ type: 'error', message: 'auth required' })).toEqual([
      { type: 'error', message: 'auth required', recoverable: true },
    ])
  })

  it('error with missing message uses a fallback', () => {
    const s = state()
    expect(s.mapper.map({ type: 'error' })).toEqual([
      { type: 'error', message: 'pi error', recoverable: true },
    ])
  })

  it('unknown event types emit nothing', () => {
    const s = state()
    expect(s.mapper.map({ type: 'some.unknown.event' })).toEqual([])
  })

  it('end-to-end Pi stream maps in order', () => {
    const s = state()
    const out: AdapterEvent[] = []
    const events: PiEvent[] = [
      { type: 'session', session_id: 'pi-abc' },
      { type: 'message_update', delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'message_update', delta: { type: 'text_delta', text: '!' } },
      { type: 'message_end', text: 'Hi!' },
      { type: 'tool_execution_start', tool_call_id: 'tc_1', tool_name: 'shell', input: { command: 'ls' } },
      { type: 'tool_execution_end', tool_call_id: 'tc_1', status: 'ok', output: 'foo.ts\n' },
      { type: 'turn_end', usage: { input_tokens: 10, output_tokens: 5 } },
    ]
    for (const e of events) {
      out.push(...s.mapper.map(e))
    }
    expect(out).toEqual([
      { type: 'text_delta', text: 'Hi' },
      { type: 'text_delta', text: '!' },
      { type: 'text', text: 'Hi!' },
      { type: 'tool_call', tool_id: 'tc_1', name: 'shell', input: { command: 'ls' } },
      { type: 'tool_result', tool_id: 'tc_1', status: 'ok', output: 'foo.ts\n' },
      { type: 'turn_complete', usage: { input: 10, output: 5 }, cost: null },
    ])
    expect(s.sessionId).toBe('pi-abc')
  })
})
