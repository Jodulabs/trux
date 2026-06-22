import { describe, it, expect, beforeEach } from 'vitest'
import { configureClient } from '../src/ports'
import { openTerminal } from '../src/terminalClient'

class FakeWS {
  static OPEN = 1
  readonly OPEN = 1
  readyState = 1
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  constructor(url: string) { this.url = url; created = this }
  send(d: string) { this.sent.push(d) }
  close() {}
  fireOpen() { this.onopen?.() }
  fireMessage(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}
let created: FakeWS | null = null

beforeEach(() => {
  created = null
  const store = new Map<string, string>([['trux_token', 'sekret']])
  configureClient({
    storage: { get: (k) => store.get(k) ?? null, set: () => {}, remove: () => {} },
    serverConfig: { httpBase: '', wsBase: 'ws://box' },
  })
})

describe('openTerminal', () => {
  it('connects to the terminal URL and authenticates on open', () => {
    openTerminal('c1', { WebSocketImpl: FakeWS as never })
    expect(created!.url).toBe('ws://box/conversations/c1/terminal')
    created!.fireOpen()
    expect(JSON.parse(created!.sent[0])).toEqual({ type: 'auth', token: 'sekret' })
  })

  it('dispatches output and frames input/resize', () => {
    const handle = openTerminal('c1', { WebSocketImpl: FakeWS as never })
    created!.fireOpen()
    const out: string[] = []
    handle.onOutput((d) => out.push(d))
    created!.fireMessage({ type: 'output', data: 'hi' })
    expect(out).toEqual(['hi'])
    handle.sendInput('ls\n')
    handle.sendResize(80, 24)
    expect(created!.sent.slice(1).map((s) => JSON.parse(s))).toEqual([
      { type: 'input', data: 'ls\n' },
      { type: 'resize', cols: 80, rows: 24 },
    ])
  })
})
