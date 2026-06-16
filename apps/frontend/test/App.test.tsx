import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App'

afterEach(cleanup)

describe('App', () => {
  it('shows the empty state when no conversation is selected', async () => {
    // Fresh Response per call: App mounts both the conversation list and the
    // workspace picker, so a single shared Response body would be read twice.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } }),
      ),
    )
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('empty')).toBeInTheDocument())
    vi.restoreAllMocks()
  })
})
