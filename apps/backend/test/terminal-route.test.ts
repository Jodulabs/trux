import { describe, it, expect } from 'vitest'
import { wireTerminalSocket, type SocketLike } from '../src/terminal-route'
import type { Config } from '../src/config'
import type { TerminalLike } from '../src/terminal'

function fakeSocket() {
  const sent: string[] = []
  let closed = false
  const handlers: Record<string, (raw?: Buffer) => void> = {}
  const socket: SocketLike = {
    send: (d) => sent.push(d),
    close: () => { closed = true },
    on: ((ev: string, cb: (raw?: Buffer) => void) => { handlers[ev] = cb }) as SocketLike['on'],
  }
  return {
    socket, sent, isClosed: () => closed,
    msg: (m: unknown) => handlers.message?.(Buffer.from(JSON.stringify(m))),
    fireClose: () => handlers.close?.(),
    types: () => sent.map((s) => JSON.parse(s).type as string),
  }
}

function fakeSession() {
  let dataCb: ((d: string) => void) | null = null
  let exitCb: ((c: number) => void) | null = null
  const calls = { writes: [] as string[], resized: null as [number, number] | null, killed: false }
  const session: TerminalLike = {
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb },
    write: (d) => calls.writes.push(d),
    resize: (c, r) => { calls.resized = [c, r] },
    kill: () => { calls.killed = true },
  }
  return { session, calls, emitData: (d: string) => dataCb?.(d), emitExit: (c: number) => exitCb?.(c) }
}

const cfg = { authRequired: true, secret: 'sekret' } as unknown as Config

describe('wireTerminalSocket', () => {
  it('rejects a non-auth first message and closes', () => {
    const s = fakeSocket()
    wireTerminalSocket(s.socket, 'c1', { config: cfg, cwdForConversation: () => '/w', makeSession: () => fakeSession().session })
    s.msg({ type: 'input', data: 'x' })
    expect(s.types()).toContain('error')
    expect(s.isClosed()).toBe(true)
  })

  it('rejects a bad token', () => {
    const s = fakeSocket()
    wireTerminalSocket(s.socket, 'c1', { config: cfg, cwdForConversation: () => '/w', makeSession: () => fakeSession().session })
    s.msg({ type: 'auth', token: 'wrong' })
    expect(JSON.parse(s.sent[0]).message).toBe('unauthorized')
    expect(s.isClosed()).toBe(true)
  })

  it('closes on an unknown conversation', () => {
    const s = fakeSocket()
    wireTerminalSocket(s.socket, 'nope', { config: cfg, cwdForConversation: () => null, makeSession: () => fakeSession().session })
    s.msg({ type: 'auth', token: 'sekret' })
    expect(JSON.parse(s.sent[0]).message).toBe('unknown conversation')
    expect(s.isClosed()).toBe(true)
  })

  it('after auth: sends ready, forwards output, writes input, resizes, kills on close', () => {
    const s = fakeSocket()
    const f = fakeSession()
    wireTerminalSocket(s.socket, 'c1', { config: cfg, cwdForConversation: () => '/work', makeSession: () => f.session })
    s.msg({ type: 'auth', token: 'sekret' })
    expect(s.types()).toContain('ready')

    f.emitData('out!')
    expect(s.sent.map((x) => JSON.parse(x)).find((m) => m.type === 'output')?.data).toBe('out!')

    s.msg({ type: 'input', data: 'ls\n' })
    expect(f.calls.writes).toEqual(['ls\n'])
    s.msg({ type: 'resize', cols: 100, rows: 40 })
    expect(f.calls.resized).toEqual([100, 40])

    s.fireClose()
    expect(f.calls.killed).toBe(true)
  })
})
