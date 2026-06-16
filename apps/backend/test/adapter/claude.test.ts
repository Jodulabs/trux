import { describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../../src/adapter/claude'
import type { AdapterEvent } from '../../src/adapter/types'

// Build a fake `query` that yields the given SDK messages, captures the
// canUseTool callback, and (when block) never completes so the outbox stays open.
function fakeQuery(messages: unknown[], block = false) {
  const calls: { interrupted: boolean } = { interrupted: false }
  let canUseTool:
    | ((
        t: string,
        i: Record<string, unknown>,
        o: { signal: AbortSignal; toolUseID: string; suggestions?: unknown[]; title?: string },
      ) => Promise<unknown>)
    | undefined
  const fn = ((arg: { options?: { canUseTool?: typeof canUseTool } }) => {
    canUseTool = arg.options?.canUseTool
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m
        if (block) await new Promise(() => {})
      },
      interrupt: async () => {
        calls.interrupted = true
      },
      close: async () => {},
    }
  }) as unknown as ConstructorParameters<typeof ClaudeAdapter>[0]
  return { fn, calls, getCanUseTool: () => canUseTool! }
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

  it('emits an approval_request and resolves allow with the input passed through', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const result = getCanUseTool()('Bash', { command: 'ls' }, {
      signal: new AbortController().signal, toolUseID: 'tu_1', suggestions: [{ x: 1 }], title: 'run ls',
    })
    const it = session.events()[Symbol.asyncIterator]()
    expect((await it.next()).value).toEqual({
      type: 'approval_request', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' }, explanation: 'run ls',
    })
    session.respondApproval('tu_1', 'allow')
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })
  })

  it('resolves allow_always with the suggestions as updatedPermissions', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const result = getCanUseTool()('Edit', { path: 'a' }, {
      signal: new AbortController().signal, toolUseID: 'tu_2', suggestions: [{ x: 1 }],
    })
    session.respondApproval('tu_2', 'allow_always')
    expect(await result).toEqual({ behavior: 'allow', updatedInput: { path: 'a' }, updatedPermissions: [{ x: 1 }] })
  })

  it('resolves deny with the note as the message', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const result = getCanUseTool()('Bash', {}, { signal: new AbortController().signal, toolUseID: 'tu_3' })
    session.respondApproval('tu_3', 'deny', 'no thanks')
    expect(await result).toEqual({ behavior: 'deny', message: 'no thanks' })
  })

  it('denies a parked approval when the signal aborts', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const ac = new AbortController()
    const result = getCanUseTool()('Bash', {}, { signal: ac.signal, toolUseID: 'tu_4' })
    ac.abort()
    expect(await result).toEqual({ behavior: 'deny', message: 'interrupted' })
  })
})
