import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('shows the empty state when no conversation is selected', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } }),
      ),
    )
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('empty')).toBeInTheDocument())
  })

  it('shows the token gate when GET /conversations returns 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })),
    )
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('token-gate')).toBeInTheDocument())
  })

  it('retries after saving a token and hides the gate on success', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls++
      if (calls === 1) {
        return Promise.resolve(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }))
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } }),
      )
    })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('token-gate')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('token-input'), { target: { value: 'my-secret' } })
    fireEvent.click(screen.getByTestId('token-save'))

    expect(localStorage.getItem('trux_token')).toBe('my-secret')
    await waitFor(() => expect(screen.queryByTestId('token-gate')).toBeNull())
  })
})
