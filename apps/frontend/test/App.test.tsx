import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from '../src/App'

// A no-op WebSocket so App mounts without a real network connection.
class NoopWebSocket {
  constructor(public url: string) {}
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

afterEach(cleanup)

describe('App', () => {
  it('renders the connecting state on mount', () => {
    vi.stubGlobal('WebSocket', NoopWebSocket)
    render(<App />)
    expect(screen.getByTestId('status')).toHaveTextContent('Connecting…')
    vi.unstubAllGlobals()
  })
})
