import { describe, expect, it } from 'vitest'
import { mapCodexLine, type CodexEvent, type CodexMapState } from '../../src/adapter/codex-map'

function state(): CodexMapState { return { threadId: null } }

describe('mapCodexLine', () => {
  it('thread.started captures threadId and emits nothing', () => {
    const s = state()
    const out = mapCodexLine({ type: 'thread.started', thread_id: 'tid-1' }, s)
    expect(out).toEqual([])
    expect(s.threadId).toBe('tid-1')
  })

  it('item.started command_execution emits tool_call', () => {
    const s = state()
    const e: CodexEvent = {
      type: 'item.started',
      item: { id: 'i1', type: 'command_execution', command: 'ls -la', aggregated_output: '', exit_code: null, status: 'in_progress' },
    }
    expect(mapCodexLine(e, s)).toEqual([
      { type: 'tool_call', tool_id: 'i1', name: 'bash', input: { command: 'ls -la' } },
    ])
  })

  it('item.started non-command types emit nothing', () => {
    const s = state()
    const e: CodexEvent = { type: 'item.started', item: { id: 'i2', type: 'agent_message', text: '' } }
    expect(mapCodexLine(e, s)).toEqual([])
  })

  it('item.completed agent_message emits text', () => {
    const s = state()
    const e: CodexEvent = {
      type: 'item.completed',
      item: { id: 'i3', type: 'agent_message', text: 'Hello there.' },
    }
    expect(mapCodexLine(e, s)).toEqual([{ type: 'text', text: 'Hello there.' }])
  })

  it('item.completed command_execution exit 0 emits tool_result ok', () => {
    const s = state()
    const e: CodexEvent = {
      type: 'item.completed',
      item: { id: 'i4', type: 'command_execution', command: 'ls', aggregated_output: 'foo.ts\n', exit_code: 0, status: 'completed' },
    }
    expect(mapCodexLine(e, s)).toEqual([
      { type: 'tool_result', tool_id: 'i4', status: 'ok', output: 'foo.ts\n' },
    ])
  })

  it('item.completed command_execution non-zero exit emits tool_result error', () => {
    const s = state()
    const e: CodexEvent = {
      type: 'item.completed',
      item: { id: 'i5', type: 'command_execution', command: 'bad', aggregated_output: 'not found\n', exit_code: 127, status: 'completed' },
    }
    expect(mapCodexLine(e, s)).toEqual([
      { type: 'tool_result', tool_id: 'i5', status: 'error', output: 'not found\n' },
    ])
  })

  it('item.completed error emits recoverable error', () => {
    const s = state()
    const e: CodexEvent = {
      type: 'item.completed',
      item: { id: 'i6', type: 'error', message: 'something broke' },
    }
    expect(mapCodexLine(e, s)).toEqual([
      { type: 'error', message: 'something broke', recoverable: true },
    ])
  })

  it('turn.completed emits turn_complete with usage', () => {
    const s = state()
    const e: CodexEvent = {
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 10, output_tokens: 50, reasoning_output_tokens: 0 },
    }
    expect(mapCodexLine(e, s)).toEqual([
      { type: 'turn_complete', usage: { input: 100, output: 50 }, cost: null },
    ])
  })

  it('unknown events emit nothing', () => {
    const s = state()
    expect(mapCodexLine({ type: 'some.unknown.event' }, s)).toEqual([])
  })
})
