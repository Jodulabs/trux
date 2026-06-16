import { describe, expect, it } from 'vitest'
import type { ServerEvent } from '@trux/protocol'
import { foldEvent, type TranscriptItem } from '../src/store'

function fold(events: ServerEvent[]): TranscriptItem[] {
  return events.reduce<TranscriptItem[]>(foldEvent, [])
}

describe('foldEvent', () => {
  it('accumulates text_delta into one text item and finalizes with text', () => {
    const items = fold([
      { type: 'user_text', turn_id: 't1', text: 'hi' },
      { type: 'turn_started', turn_id: 't1' },
      { type: 'text_delta', turn_id: 't1', text: 'Hel' },
      { type: 'text_delta', turn_id: 't1', text: 'lo' },
      { type: 'text', turn_id: 't1', text: 'Hello' },
    ])
    expect(items).toEqual([
      { type: 'user_text', turn_id: 't1', text: 'hi' },
      { type: 'text', turn_id: 't1', text: 'Hello' },
    ])
  })

  it('keeps tool_call and tool_result as discrete items', () => {
    const items = fold([
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'a' },
    ])
    expect(items.map((i) => i.type)).toEqual(['tool_call', 'tool_result'])
  })

  it('ignores status/turn_complete for the transcript', () => {
    const items = fold([
      { type: 'status', state: 'thinking' },
      { type: 'turn_complete', turn_id: 't1', cost: 0 },
    ])
    expect(items).toEqual([])
  })
})
