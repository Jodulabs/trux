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

describe('foldEvent optimistic reconciliation', () => {
  it('replaces a pending optimistic bubble with the server echo by client_message_id', () => {
    const optimistic: TranscriptItem = {
      type: 'user_text', turn_id: '', text: 'hi', client_message_id: 'm1', pending: true,
    } as TranscriptItem
    const items = foldEvent([optimistic], {
      type: 'user_text', turn_id: 't1', text: 'hi', client_message_id: 'm1',
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ type: 'user_text', turn_id: 't1', text: 'hi', client_message_id: 'm1' })
  })

  it('appends a user_text with no matching optimistic id', () => {
    const items = foldEvent([], { type: 'user_text', turn_id: 't1', text: 'hi', client_message_id: 'm9' })
    expect(items).toHaveLength(1)
  })
})

describe('applyEvent history_delta', () => {
  it('folds a delta batch in order and tracks lastSeq', () => {
    useStore.setState({ transcript: [], lastSeq: -1, status: 'idle' })
    useStore.getState().applyEvent({
      type: 'history_delta',
      events: [
        { type: 'user_text', turn_id: 't1', text: 'hi', seq: 3 },
        { type: 'text', turn_id: 't1', text: 'yo', seq: 4 },
        { type: 'status', state: 'idle', seq: 5 },
      ],
    })
    expect(useStore.getState().transcript.map((i) => i.type)).toEqual(['user_text', 'text'])
    expect(useStore.getState().lastSeq).toBe(5)
  })
})

describe('recordApproval', () => {
  it('records the decision for a request id', () => {
    useStore.getState().recordApproval('tu_1', 'allow')
    expect(useStore.getState().approvalDecisions['tu_1']).toBe('allow')
  })
})

describe('failPending', () => {
  it('marks pending optimistic bubbles failed and returns their ids', () => {
    useStore.setState({
      transcript: [
        { type: 'user_text', turn_id: '', text: 'hi', client_message_id: 'm1', pending: true },
        { type: 'text', turn_id: 't1', text: 'reply' },
      ] as TranscriptItem[],
    })
    const ids = useStore.getState().failPending()
    expect(ids).toEqual(['m1'])
    const bubble = useStore.getState().transcript[0] as { pending?: boolean; failed?: boolean }
    expect(bubble.pending).toBe(false)
    expect(bubble.failed).toBe(true)
  })
})

describe('previewPort', () => {
  it('sets previewPort from a port_detected event', () => {
    useStore.getState().applyEvent({ type: 'port_detected', port: 5173 })
    expect(useStore.getState().previewPort).toBe(5173)
  })
})

describe('convMeta', () => {
  it('setConvMeta creates a new entry with defaults merged in', () => {
    useStore.setState({ convMeta: {} })
    useStore.getState().setConvMeta('c1', { status: 'thinking' })
    expect(useStore.getState().convMeta['c1']).toMatchObject({ status: 'thinking', unread: 0, lastSeq: -1 })
  })

  it('bumpUnread increments unread for a background conversation', () => {
    useStore.setState({ convMeta: {} })
    useStore.getState().bumpUnread('c1')
    useStore.getState().bumpUnread('c1')
    expect(useStore.getState().convMeta['c1']?.unread).toBe(2)
  })

  it('clearUnread resets the unread counter to 0', () => {
    useStore.setState({ convMeta: { c1: { status: 'idle', unread: 5, connState: 'connected', lastSeq: 3, totalCost: 0 } } })
    useStore.getState().clearUnread('c1')
    expect(useStore.getState().convMeta['c1']?.unread).toBe(0)
  })

  it('setConvMeta patches without clobbering other fields', () => {
    useStore.setState({ convMeta: { c1: { status: 'thinking', unread: 3, connState: 'connected', lastSeq: 7, totalCost: 0.5 } } })
    useStore.getState().setConvMeta('c1', { status: 'idle' })
    expect(useStore.getState().convMeta['c1']).toEqual({ status: 'idle', unread: 3, connState: 'connected', lastSeq: 7, totalCost: 0.5 })
  })
})

describe('setTitle', () => {
  it('setTitle updates the conversation in the list and convMeta', () => {
    useStore.setState({
      conversations: [
        { id: 'c1', agent: 'claude', cwd: '/repo/darshi', title: null, status: 'idle',
          native_session_id: null, archived: false, created_at: 1, updated_at: 1 },
      ],
      convMeta: {},
    })
    useStore.getState().setTitle('c1', 'Fix auth redirect')
    expect(useStore.getState().conversations[0]?.title).toBe('Fix auth redirect')
    expect(useStore.getState().convMeta['c1']?.title).toBe('Fix auth redirect')
  })
})
