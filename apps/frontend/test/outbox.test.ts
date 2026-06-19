import { afterEach, describe, expect, it } from 'vitest'
import { enqueue, loadQueue, dequeue, newMessageId } from '../src/outbox'

afterEach(() => {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('trux_outbox_')) localStorage.removeItem(k)
  }
})

describe('outbox', () => {
  it('round-trips a queued message with config (replay re-sends the same selection)', () => {
    const cid = newMessageId()
    enqueue('c1', {
      client_message_id: cid,
      text: 'hi',
      config: { model: 'claude-opus-4-8', options: { effort: 'high' } },
    })
    const q = loadQueue('c1')
    expect(q).toHaveLength(1)
    expect(q[0].config).toEqual({ model: 'claude-opus-4-8', options: { effort: 'high' } })
  })

  it('dequeues by client_message_id', () => {
    enqueue('c2', { client_message_id: 'm1', text: 'a' })
    enqueue('c2', { client_message_id: 'm2', text: 'b' })
    dequeue('c2', 'm1')
    expect(loadQueue('c2').map((m) => m.client_message_id)).toEqual(['m2'])
  })
})
