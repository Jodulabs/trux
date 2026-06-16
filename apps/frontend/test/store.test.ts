import { describe, expect, it } from 'vitest'
import type { ServerEvent } from '@trux/protocol'
import { foldEvent, useStore, type TranscriptItem } from '../src/store'

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

describe('foldEvent approvals', () => {
  it('keeps an approval_request as a transcript item', () => {
    const items = fold([
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } },
    ])
    expect(items).toEqual([
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' } },
    ])
  })
})

describe('recordApproval', () => {
  it('records the decision for a request id', () => {
    useStore.getState().recordApproval('tu_1', 'allow')
    expect(useStore.getState().approvalDecisions['tu_1']).toBe('allow')
  })
})

describe('previewPort', () => {
  it('sets previewPort from a port_detected event', () => {
    useStore.getState().applyEvent({ type: 'port_detected', port: 5173 })
    expect(useStore.getState().previewPort).toBe(5173)
  })
})
