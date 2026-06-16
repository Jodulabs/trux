import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../../src/adapter/claude'
import type { AdapterEvent } from '../../src/adapter/types'

// Build a fake `query` that yields the given SDK messages and records interrupts.
function fakeQuery(messages: unknown[]) {
  const calls: { interrupted: boolean } = { interrupted: false }
  const fn = (() => ({
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m
    },
    interrupt: async () => {
      calls.interrupted = true
    },
    close: async () => {},
  })) as unknown as ConstructorParameters<typeof ClaudeAdapter>[0]
  return { fn, calls }
}

async function collect(events: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> {
  const out: AdapterEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

describe('ClaudeAdapter mapping', () => {
  it('maps system/stream/assistant/user/result messages to NCP adapter events', async () => {
    const messages = [
      { type: 'system', subtype: 'init', session_id: 'sess_1' },
      { type: 'stream_event', stream_event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } },
      { type: 'stream_event', stream_event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } },
      { type: 'assistant', session_id: 'sess_1', message: { content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
      ] } },
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'a\nb', is_error: false },
      ] } },
      { type: 'result', subtype: 'success', session_id: 'sess_1', total_cost_usd: 0.01,
        usage: { input_tokens: 12, output_tokens: 34 } },
    ]
    const { fn } = fakeQuery(messages)
    const adapter = new ClaudeAdapter(fn)
    const session = adapter.start({ cwd: '/repo' })
    const events = await collect(session.events())
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
      { type: 'text', text: 'Hello' },
      { type: 'tool_call', tool_id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', tool_id: 'tu_1', status: 'ok', output: 'a\nb' },
      { type: 'turn_complete', usage: { input: 12, output: 34 }, cost: 0.01 },
    ])
    expect(session.nativeSessionId()).toBe('sess_1')
  })

  it('marks an errored tool_result with status error', async () => {
    const messages = [
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_9', content: 'boom', is_error: true },
      ] } },
    ]
    const { fn } = fakeQuery(messages)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const events = await collect(session.events())
    expect(events).toEqual([{ type: 'tool_result', tool_id: 'tu_9', status: 'error', output: 'boom' }])
  })

  it('forwards interrupt to the underlying query', async () => {
    const { fn, calls } = fakeQuery([])
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    await session.interrupt()
    expect(calls.interrupted).toBe(true)
  })
})
