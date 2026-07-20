import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { PiAdapter, type SpawnFn, type ChildProcessLike } from '../../src/adapter/pi'
import type { AdapterEvent } from '../../src/adapter/types'
import type { RunFn } from '../../src/discover'

// A discoverer run that returns no models — keeps the capabilities() manifest
// empty and deterministic regardless of whether `pi` is on PATH in the test env.
const noModels: RunFn = () => null

class FakeProc extends EventEmitter implements ChildProcessLike {
  readonly stdout = new EventEmitter()
  readonly killedWith: string[] = []

  writeLine(line: string): void {
    this.stdout.emit('data', Buffer.from(line + '\n'))
  }

  close(code: number | null = 0): void {
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

describe('PiAdapter', () => {
  it('capabilities returns a manifest with thinking control (models from discoverer)', () => {
    const adapter = new PiAdapter(undefined, noModels)
    const caps = adapter.capabilities()
    expect(caps.agent).toBe('pi')
    expect(caps.models).toEqual([]) // noModels returns null → empty list
    expect(caps.defaultModel).toBeNull()
    // thinking control is always present (Pi's native --thinking flag).
    expect(caps.controls.map((c) => c.key)).toContain('thinking')
  })

  it('first send spawns pi --mode json with the prompt', async () => {
    const { fn } = fakeSpawn()
    const spawnedArgs: string[][] = []
    const trackingFn: SpawnFn = (args, opts) => { spawnedArgs.push(args); return fn(args, opts) }
    const adapter = new PiAdapter(trackingFn, noModels)
    const session = adapter.start({ cwd: '/repo' })

    session.send('list files')
    await tick()

    expect(spawnedArgs[0]).toEqual(['--mode', 'json', 'list files'])
  })

  it('subsequent send uses --session with the captured session id', async () => {
    const { fn, procs } = fakeSpawn()
    const spawnedArgs: string[][] = []
    const trackingFn: SpawnFn = (args, opts) => { spawnedArgs.push(args); return fn(args, opts) }
    const adapter = new PiAdapter(trackingFn, noModels)
    const session = adapter.start({ cwd: '/repo' })

    session.send('first')
    await tick()
    procs[0].writeLine(JSON.stringify({ type: 'session', session_id: 'pi-sess-1' }))
    procs[0].writeLine(JSON.stringify({ type: 'turn_end' }))
    procs[0].close(0)
    await tick()

    session.send('second')
    await tick()
    expect(spawnedArgs[1]).toEqual(['--mode', 'json', '--session', 'pi-sess-1', 'second'])
    expect(session.nativeSessionId()).toBe('pi-sess-1')
  })

  it('resume is carried by --session from start({resume})', async () => {
    const { fn } = fakeSpawn()
    const spawnedArgs: string[][] = []
    const trackingFn: SpawnFn = (args, opts) => { spawnedArgs.push(args); return fn(args, opts) }
    const adapter = new PiAdapter(trackingFn, noModels)
    const session = adapter.start({ cwd: '/repo', resume: 'pi-existing' })

    session.send('continue')
    await tick()
    expect(spawnedArgs[0]).toEqual(['--mode', 'json', '--session', 'pi-existing', 'continue'])
    expect(session.nativeSessionId()).toBe('pi-existing')
  })

  it('config.model and config.options.thinking are passed as --model and --thinking', async () => {
    const { fn } = fakeSpawn()
    const spawnedArgs: string[][] = []
    const trackingFn: SpawnFn = (args, opts) => { spawnedArgs.push(args); return fn(args, opts) }
    const adapter = new PiAdapter(trackingFn, noModels)
    const session = adapter.start({
      cwd: '/repo',
      config: { model: 'anthropic/claude-sonnet-5', options: { thinking: 'high' } },
    })

    session.send('solve this')
    await tick()
    expect(spawnedArgs[0]).toEqual([
      '--mode', 'json',
      '--model', 'anthropic/claude-sonnet-5',
      '--thinking', 'high',
      'solve this',
    ])
  })

  it('omits --model and --thinking when the selection is empty (native default)', async () => {
    const { fn } = fakeSpawn()
    const spawnedArgs: string[][] = []
    const trackingFn: SpawnFn = (args, opts) => { spawnedArgs.push(args); return fn(args, opts) }
    const adapter = new PiAdapter(trackingFn, noModels)
    const session = adapter.start({ cwd: '/repo', config: { model: null, options: {} } })

    session.send('go')
    await tick()
    expect(spawnedArgs[0]).toEqual(['--mode', 'json', 'go'])
  })

  it('maps an event-by-event Pi stream to adapter events', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
    const session = adapter.start({ cwd: '/repo' })
    session.send('hi')
    await tick()

    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'turn_complete') break
      }
    })()

    procs[0].writeLine(JSON.stringify({ type: 'session', session_id: 'pi-1' }))
    procs[0].writeLine(JSON.stringify({ type: 'message_update', delta: { type: 'text_delta', text: 'Hi' } }))
    procs[0].writeLine(JSON.stringify({ type: 'message_end', text: 'Hi!' }))
    procs[0].writeLine(JSON.stringify({ type: 'tool_execution_start', tool_call_id: 'tc_1', tool_name: 'shell', input: { command: 'ls' } }))
    procs[0].writeLine(JSON.stringify({ type: 'tool_execution_end', tool_call_id: 'tc_1', status: 'ok', output: 'foo.ts\n' }))
    procs[0].writeLine(JSON.stringify({ type: 'turn_end', usage: { input_tokens: 10, output_tokens: 5 } }))
    procs[0].close(0)
    await pump

    expect(got).toEqual([
      { type: 'text_delta', text: 'Hi' },
      { type: 'text', text: 'Hi!' },
      { type: 'tool_call', tool_id: 'tc_1', name: 'shell', input: { command: 'ls' } },
      { type: 'tool_result', tool_id: 'tc_1', status: 'ok', output: 'foo.ts\n' },
      { type: 'turn_complete', usage: { input: 10, output: 5 }, cost: null },
    ])
    expect(session.nativeSessionId()).toBe('pi-1')
  })

  it('deduplicates tool lifecycle events by tool_call_id', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
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

    // Pi re-emits start and end for the same tool_call_id (progress / retries).
    procs[0].writeLine(JSON.stringify({ type: 'tool_execution_start', tool_call_id: 'tc_1', tool_name: 'shell', input: {} }))
    procs[0].writeLine(JSON.stringify({ type: 'tool_execution_start', tool_call_id: 'tc_1', tool_name: 'shell', input: {} }))
    procs[0].writeLine(JSON.stringify({ type: 'tool_execution_end', tool_call_id: 'tc_1', status: 'ok', output: 'a' }))
    procs[0].writeLine(JSON.stringify({ type: 'tool_execution_end', tool_call_id: 'tc_1', status: 'ok', output: 'b' }))
    procs[0].writeLine(JSON.stringify({ type: 'turn_end' }))
    procs[0].close(0)
    await pump

    const toolCalls = got.filter((e) => e.type === 'tool_call')
    const toolResults = got.filter((e) => e.type === 'tool_result')
    expect(toolCalls).toHaveLength(1)
    expect(toolResults).toHaveLength(1)
    // The first emission wins (output 'a'), not the re-emission ('b').
    expect(toolResults[0]).toEqual({ type: 'tool_result', tool_id: 'tc_1', status: 'ok', output: 'a' })
  })

  it('emits synthetic turn_complete if process closes without turn_end', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
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

    procs[0].writeLine(JSON.stringify({ type: 'message_end', text: 'partial' }))
    procs[0].close(0) // no turn_end line
    await pump

    expect(got.at(-1)).toEqual({ type: 'turn_complete', cost: null })
  })

  it('emits recoverable error and synthetic turn_complete on non-zero close without turn_end', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
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

    procs[0].close(127) // abnormal exit, no error event, no turn_end
    await pump

    expect(got).toContainEqual({ type: 'error', message: 'pi process exited with code 127', recoverable: true })
    expect(got.at(-1)).toEqual({ type: 'turn_complete', cost: null })
  })

  it('does NOT emit a synthetic error when an explicit error event was already emitted', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
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

    procs[0].writeLine(JSON.stringify({ type: 'error', message: 'auth required' }))
    procs[0].close(1)
    await pump

    // Exactly one error: the explicit one. The close handler should not double.
    expect(got.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', message: 'auth required', recoverable: true },
    ])
    expect(got.at(-1)).toEqual({ type: 'turn_complete', cost: null })
  })

  it('does NOT emit a synthetic turn_complete if turn_end was already emitted', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
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

    procs[0].writeLine(JSON.stringify({ type: 'turn_end', usage: { input_tokens: 1, output_tokens: 1 } }))
    procs[0].close(0)
    await pump

    expect(got.filter((e) => e.type === 'turn_complete')).toEqual([
      { type: 'turn_complete', usage: { input: 1, output: 1 }, cost: null },
    ])
  })

  it('interrupt kills the active process', async () => {
    const { fn, procs } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
    const session = adapter.start({ cwd: '/repo' })
    session.send('work')
    await tick()

    await session.interrupt()
    expect(procs[0].killedWith).toContain('SIGTERM')
  })

  it('respondApproval is a no-op (Pi has no approval protocol)', () => {
    const { fn } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
    const session = adapter.start({ cwd: '/repo' })
    expect(() => session.respondApproval('req1', 'allow')).not.toThrow()
  })

  it('close ends the outbox without throwing', async () => {
    const { fn } = fakeSpawn()
    const adapter = new PiAdapter(fn, noModels)
    const session = adapter.start({ cwd: '/repo' })
    await expect(session.close()).resolves.toBeUndefined()
  })
})
