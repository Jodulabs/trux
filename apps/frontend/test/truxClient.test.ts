import { describe, expect, it, vi } from 'vitest'
import type { ServerEvent } from '@trux/protocol'
import { connectTrux } from '../src/truxClient'

// Minimal fake of the browser WebSocket, enough to drive connectTrux in tests.
class FakeWebSocket {
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}
  constructor(public url: string) {}
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    ;(this.listeners[type] ??= []).push(fn)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {}
  emit(type: string, ev: unknown): void {
    for (const fn of this.listeners[type] ?? []) fn(ev)
  }
}

describe('connectTrux', () => {
  it('sends an auth frame on open', () => {
    let socket!: FakeWebSocket
    connectTrux({
      url: 'ws://x/stream',
      token: 'secret',
      WebSocketImpl: class extends FakeWebSocket {
        constructor(url: string) {
          super(url)
          socket = this
        }
      } as unknown as typeof WebSocket,
    })
    socket.emit('open', {})
    expect(socket.sent).toEqual([JSON.stringify({ type: 'auth', token: 'secret' })])
  })

  it('invokes onReady when a hello event arrives', () => {
    let socket!: FakeWebSocket
    const onReady = vi.fn()
    connectTrux({
      url: 'ws://x/stream',
      onReady,
      WebSocketImpl: class extends FakeWebSocket {
        constructor(url: string) {
          super(url)
          socket = this
        }
      } as unknown as typeof WebSocket,
    })
    const hello: ServerEvent = { type: 'hello', protocol_version: 1, server: 'trux' }
    socket.emit('message', { data: JSON.stringify(hello) })
    expect(onReady).toHaveBeenCalledWith(hello)
  })
})
