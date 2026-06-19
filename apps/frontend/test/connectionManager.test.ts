import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEvent } from '@trux/protocol'

// Mock truxClient so we can control events without opening real WebSockets.
vi.mock('../src/truxClient', () => {
  const clients: { id: string; handlers: { onEvent?: (e: ServerEvent) => void; onConnState?: (s: string) => void }; closed: boolean }[] = []
  return {
    connectTrux: vi.fn((opts: { url: string; onEvent?: (e: ServerEvent) => void; onConnState?: (s: string) => void }) => {
      const client = { id: opts.url, handlers: { onEvent: opts.onEvent, onConnState: opts.onConnState }, closed: false, close: () => { client.closed = true }, sendUserMessage: vi.fn(), respondApproval: vi.fn(), interrupt: vi.fn() }
      clients.push(client)
      return client
    }),
    _clients: clients,
  }
})

// Mock outbox
vi.mock('../src/outbox', () => ({
  loadQueue: vi.fn(() => []),
  dequeue: vi.fn(),
  enqueue: vi.fn(),
  newMessageId: vi.fn(() => 'msg-1'),
}))

// Capture the connectTrux calls to inspect created clients.
import { connectTrux } from '../src/truxClient'
import { openConnection, setActiveHandlers, clearActiveHandlers, getConnection } from '../src/connectionManager'
import { useStore } from '../src/store'

beforeEach(() => {
  vi.mocked(connectTrux).mockClear()
  // Reset store state
  useStore.setState({ convMeta: {}, currentId: null })
  clearActiveHandlers()
})

describe('openConnection', () => {
  it('creates a TruxClient on first call', () => {
    openConnection('conv-1')
    expect(connectTrux).toHaveBeenCalledOnce()
  })

  it('does NOT create a second client on repeated calls for the same id', () => {
    openConnection('conv-2')
    openConnection('conv-2')
    openConnection('conv-2')
    expect(connectTrux).toHaveBeenCalledTimes(1)
  })

  it('creates separate clients for different ids', () => {
    openConnection('conv-a')
    openConnection('conv-b')
    expect(connectTrux).toHaveBeenCalledTimes(2)
  })

  it('exposes the client via getConnection', () => {
    openConnection('conv-3')
    expect(getConnection('conv-3')).toBeDefined()
  })
})

describe('event routing', () => {
  it('background event bumps unread but does NOT call active handler', () => {
    useStore.setState({ currentId: 'active' })
    openConnection('bg-1')
    // Register active handlers for a different conversation
    const activeOnEvent = vi.fn()
    setActiveHandlers({ id: 'active', onEvent: activeOnEvent, onConnState: vi.fn() })

    // Simulate a turn_complete arriving for the background conversation
    const client = getConnection('bg-1') as unknown as { handlers: { onEvent?: (e: ServerEvent) => void } }
    client.handlers.onEvent?.({ type: 'turn_complete', turn_id: 't1', cost: 0 })

    expect(useStore.getState().convMeta['bg-1']?.unread).toBe(1)
    expect(activeOnEvent).not.toHaveBeenCalled()
  })

  it('foreground event calls the active handler', () => {
    useStore.setState({ currentId: 'fg-1' })
    openConnection('fg-1')
    const activeOnEvent = vi.fn()
    setActiveHandlers({ id: 'fg-1', onEvent: activeOnEvent, onConnState: vi.fn() })

    const client = getConnection('fg-1') as unknown as { handlers: { onEvent?: (e: ServerEvent) => void } }
    client.handlers.onEvent?.({ type: 'turn_complete', turn_id: 't1', cost: 0 })

    expect(activeOnEvent).toHaveBeenCalledWith({ type: 'turn_complete', turn_id: 't1', cost: 0 })
    // Active conversation doesn't bump unread
    expect(useStore.getState().convMeta['fg-1']?.unread ?? 0).toBe(0)
  })

  it('status event updates convMeta.status', () => {
    openConnection('status-1')
    const client = getConnection('status-1') as unknown as { handlers: { onEvent?: (e: ServerEvent) => void } }
    client.handlers.onEvent?.({ type: 'status', state: 'thinking' })
    expect(useStore.getState().convMeta['status-1']?.status).toBe('thinking')
  })

  it('clearActiveHandlers stops routing to that handler', () => {
    useStore.setState({ currentId: 'fg-2' })
    openConnection('fg-2')
    const activeOnEvent = vi.fn()
    setActiveHandlers({ id: 'fg-2', onEvent: activeOnEvent, onConnState: vi.fn() })
    clearActiveHandlers()

    const client = getConnection('fg-2') as unknown as { handlers: { onEvent?: (e: ServerEvent) => void } }
    client.handlers.onEvent?.({ type: 'turn_complete', turn_id: 't1', cost: 0 })
    expect(activeOnEvent).not.toHaveBeenCalled()
  })
})
