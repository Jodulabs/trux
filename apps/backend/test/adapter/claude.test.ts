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
  let capturedOptions: Record<string, unknown> | undefined
  const fn = ((arg: { options?: Record<string, unknown> & { canUseTool?: typeof canUseTool } }) => {
    capturedOptions = arg.options
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
  return { fn, calls, getCanUseTool: () => canUseTool!, getOptions: () => capturedOptions! }
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

  it('splits an image content block out of a tool_result into images[]', async () => {
    const messages = [
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_5', is_error: false, content: [
          { type: 'text', text: 'screenshot saved' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' } },
        ] },
      ] } },
    ]
    const { fn } = fakeQuery(messages)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const events = await collect(session.events())
    expect(events).toEqual([
      {
        type: 'tool_result', tool_id: 'tu_5', status: 'ok', output: 'screenshot saved',
        images: [{ kind: 'image', media_type: 'image/png', data: 'BASE64DATA' }],
      },
    ])
  })

  it('forwards interrupt to the underlying query', async () => {
    const { fn, calls } = fakeQuery([])
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    await session.interrupt()
    expect(calls.interrupted).toBe(true)
  })

  it('runs in isolation so trux owns permissions (default mode, no filesystem settings)', () => {
    const { fn, getOptions } = fakeQuery([])
    new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const options = getOptions()
    // settingSources [] keeps the user's global ~/.claude allow-list from
    // bypassing canUseTool; default mode means mutations route through it.
    expect(options.settingSources).toEqual([])
    expect(options.permissionMode).toBe('default')
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

  it('allow_edits auto-approves later Edit/Write calls without prompting', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const opts = (id: string) => ({ signal: new AbortController().signal, toolUseID: id })
    // First Edit prompts; user grants "allow all edits".
    const first = getCanUseTool()('Edit', { file_path: 'a.ts' }, opts('tu_1'))
    session.respondApproval('tu_1', 'allow_edits')
    expect(await first).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a.ts' } })
    // A later Write resolves immediately — no second approval_request parked.
    const second = getCanUseTool()('Write', { file_path: 'b.ts' }, opts('tu_2'))
    expect(await second).toEqual({ behavior: 'allow', updatedInput: { file_path: 'b.ts' } })
  })

  it('allow_command pins the exact command; a different command still prompts', async () => {
    const { fn, getCanUseTool } = fakeQuery([], true)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const opts = (id: string) => ({ signal: new AbortController().signal, toolUseID: id })
    const first = getCanUseTool()('Bash', { command: 'pnpm test' }, opts('tu_1'))
    session.respondApproval('tu_1', 'allow_command')
    expect(await first).toEqual({ behavior: 'allow', updatedInput: { command: 'pnpm test' } })
    // Same command → auto-allowed.
    const same = getCanUseTool()('Bash', { command: 'pnpm test' }, opts('tu_2'))
    expect(await same).toEqual({ behavior: 'allow', updatedInput: { command: 'pnpm test' } })
    // Different command → parks a new approval_request (not yet resolved).
    let resolved = false
    void getCanUseTool()('Bash', { command: 'rm -rf dist' }, opts('tu_3')).then(() => { resolved = true })
    await new Promise((r) => setTimeout(r, 5))
    expect(resolved).toBe(false)
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

describe('ClaudeAdapter capabilities + config routing', () => {
  it('declares a model list and an effort control', () => {
    const caps = new ClaudeAdapter(fakeQuery([]).fn).capabilities()
    expect(caps.agent).toBe('claude')
    expect(caps.models.map((m) => m.value)).toContain('claude-opus-4-8')
    expect(caps.controls.find((c) => c.key === 'effort')).toBeTruthy()
    expect(caps.defaultModel).toBeNull()
  })

  it('passes model + effort into the SDK query options when set', () => {
    const { fn, getOptions } = fakeQuery([])
    new ClaudeAdapter(fn).start({ cwd: '/x', config: { model: 'claude-opus-4-8', options: { effort: 'high' } } })
    const options = getOptions()
    expect(options.model).toBe('claude-opus-4-8')
    expect(options.effort).toBe('high')
  })

  it('omits model/effort when the selection is empty (no override)', () => {
    const { fn, getOptions } = fakeQuery([])
    new ClaudeAdapter(fn).start({ cwd: '/x', config: { model: null, options: {} } })
    const options = getOptions()
    expect(options.model).toBeUndefined()
    expect(options.effort).toBeUndefined()
  })
})
