import { describe, expect, it } from 'vitest'
import { OpencodeAdapter, type OcClient } from '../../src/adapter/opencode'
import type { OcEvent } from '../../src/adapter/opencode-map'
import type { AdapterEvent } from '../../src/adapter/types'
import { PushQueue } from '../../src/adapter/queue'

// A fake opencode client with a controllable event stream and recorded calls.
function fakeClient() {
  const stream = new PushQueue<OcEvent>()
  const calls = { prompts: [] as string[], aborts: 0, permissions: [] as string[], createdDir: '' }
  const client: OcClient = {
    session: {
      create: async ({ query }) => {
        calls.createdDir = query.directory
        return { data: { id: 's1' } }
      },
      promptAsync: async ({ body }) => {
        calls.prompts.push(body.parts[0]?.text ?? '')
      },
      abort: async () => {
        calls.aborts += 1
      },
    },
    postSessionIdPermissionsPermissionId: async ({ body }) => {
      calls.permissions.push(body.response)
    },
    event: {
      subscribe: async () => ({ stream: stream.iterable() }),
    },
  }
  return { client, stream, calls }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('OpencodeAdapter', () => {
  it('creates a session in the cwd, prompts, and streams mapped events', async () => {
    const { client, stream, calls } = fakeClient()
    const adapter = new OpencodeAdapter(async () => ({ client, server: { close() {} } }))
    const session = adapter.start({ cwd: '/repo' })
    session.send('hello')
    await tick()
    expect(calls.createdDir).toBe('/repo')
    expect(calls.prompts).toEqual(['hello'])
    expect(session.nativeSessionId()).toBe('s1')

    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'turn_complete') break
      }
    })()
    stream.push({ type: 'message.part.updated', properties: { part: { type: 'text', id: 'p', sessionID: 's1', text: 'hi', time: { end: 1 } } } })
    stream.push({ type: 'session.idle', properties: { sessionID: 's1' } })
    await pump
    expect(got).toEqual([{ type: 'text', text: 'hi' }, { type: 'turn_complete', cost: null }])
  })

  it('routes approvals and maps decisions to opencode responses', async () => {
    const { client, stream, calls } = fakeClient()
    const adapter = new OpencodeAdapter(async () => ({ client, server: { close() {} } }))
    const session = adapter.start({ cwd: '/repo' })
    session.send('go')
    await tick()
    const got: AdapterEvent[] = []
    const pump = (async () => {
      for await (const e of session.events()) {
        got.push(e)
        if (e.type === 'approval_request') break
      }
    })()
    stream.push({ type: 'permission.updated', properties: { id: 'perm1', type: 'bash', sessionID: 's1', title: 'Run', metadata: {} } })
    await pump
    expect(got.at(-1)).toEqual({ type: 'approval_request', request_id: 'perm1', tool: 'bash', input: {}, explanation: 'Run' })

    session.respondApproval('perm1', 'allow_always')
    await tick()
    expect(calls.permissions).toEqual(['always'])
  })

  it('interrupt calls session.abort', async () => {
    const { client, calls } = fakeClient()
    const adapter = new OpencodeAdapter(async () => ({ client, server: { close() {} } }))
    const session = adapter.start({ cwd: '/repo' })
    session.send('x')
    await tick()
    await session.interrupt()
    expect(calls.aborts).toBe(1)
  })
})
