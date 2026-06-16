import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { CodexAdapter, type SpawnFn, type ChildProcessLike } from '../../src/adapter/codex'
import type { AdapterEvent } from '../../src/adapter/types'

class FakeProc extends EventEmitter implements ChildProcessLike {
  readonly stdout = new EventEmitter()
  readonly killedWith: string[] = []

  writeLine(line: string): void {
    this.stdout.emit('data', Buffer.from(line + '\n'))
  }

  close(code = 0): void {
    this.emit('close', code)
  }

  kill(signal = 'SIGTERM'): boolean {
    this.killedWith.push(signal)
    return true
  }
}

function fakeSpawn() {
  const procs: FakeProc[] = []
  const fn: SpawnFn = (_args, _opts) => {
    const proc = new FakeProc()
    procs.push(proc)
    return proc
  }
  return { fn, procs }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('CodexAdapter', () => {
  it('first send spawns exec with workspace-write sandbox', async () => {
    const { fn } = fakeSpawn()
    const spawnedArgs: string[][] = []
    const trackingFn: SpawnFn = (args, opts) => { spawnedArgs.push(args); return fn(args, opts) }
    const adapter = new CodexAdapter(trackingFn)
    const session = adapter.start({ cwd: '/repo' })

    session.send('list files')
    await tick()

    expect(spawnedArgs[0]).toEqual(['exec', '--json', '-C', '/repo', '-s', 'workspace-write', 'list files'])
  })

  it('subsequent send uses exec resume with thread_id', async () => {
    const { fn, procs } = fakeSpawn()
    const spawnedArgs: string[][] = []
    const trackingFn: SpawnFn = (args, opts) => { spawnedArgs.push(args); return fn(args, opts) }
    const adapter = new CodexAdapter(trackingFn)
    const session = adapter.start({ cwd: '/repo' })

    session.send('first')
    await tick()
    // Emit thread.started so threadId is captured
    procs[0].writeLine(JSON.stringify({ type: 'thread.started', thread_id: 'tid-abc' }))
    procs[0].writeLine(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } }))
    procs[0].close(0)
    await tick()

    session.send('second')
    await tick()
    expect(spawnedArgs[1]).toEqual(['exec', 'resume', '--json', 'tid-abc', 'second'])
    expect(session.nativeSessionId()).toBe('tid-abc')
  })

  it('maps agent_message and turn_complete events', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new CodexAdapter(fn)
    const session = adapter.start({ cwd: '/repo' })
    session.send('hello')
    await tick()

    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'turn_complete') break
      }
    })()

    procs[0].writeLine(JSON.stringify({ type: 'thread.started', thread_id: 'tid-1' }))
    procs[0].writeLine(JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Hi!' } }))
    procs[0].writeLine(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 8, reasoning_output_tokens: 0 } }))
    procs[0].close(0)
    await pump

    expect(got).toEqual([
      { type: 'text', text: 'Hi!' },
      { type: 'turn_complete', usage: { input: 20, output: 8 }, cost: null },
    ])
  })

  it('maps tool_call and tool_result for command_execution', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new CodexAdapter(fn)
    const session = adapter.start({ cwd: '/repo' })
    session.send('run ls')
    await tick()

    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'turn_complete') break
      }
    })()

    procs[0].writeLine(JSON.stringify({ type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'ls -la', aggregated_output: '', exit_code: null, status: 'in_progress' } }))
    procs[0].writeLine(JSON.stringify({ type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'ls -la', aggregated_output: 'foo.ts\n', exit_code: 0, status: 'completed' } }))
    procs[0].writeLine(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: 0 } }))
    procs[0].close(0)
    await pump

    expect(got[0]).toEqual({ type: 'tool_call', tool_id: 'c1', name: 'bash', input: { command: 'ls -la' } })
    expect(got[1]).toEqual({ type: 'tool_result', tool_id: 'c1', status: 'ok', output: 'foo.ts\n' })
    expect(got[2]?.type).toBe('turn_complete')
  })

  it('emits synthetic turn_complete if process closes without one', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new CodexAdapter(fn)
    const session = adapter.start({ cwd: '/repo' })
    session.send('go')
    await tick()

    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'turn_complete') break
      }
    })()

    procs[0].writeLine(JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Done.' } }))
    procs[0].close(0) // no turn.completed line
    await pump

    expect(got.at(-1)).toEqual({ type: 'turn_complete', cost: null })
  })

  it('interrupt kills the active process', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new CodexAdapter(fn)
    const session = adapter.start({ cwd: '/repo' })
    session.send('work')
    await tick()

    await session.interrupt()
    expect(procs[0].killedWith).toContain('SIGTERM')
  })

  it('respondApproval is a no-op (codex has no per-tool approvals)', () => {
    const { fn } = fakeSpawn()
    const adapter = new CodexAdapter(fn)
    const session = adapter.start({ cwd: '/repo' })
    expect(() => session.respondApproval('req1', 'allow')).not.toThrow()
  })
})
