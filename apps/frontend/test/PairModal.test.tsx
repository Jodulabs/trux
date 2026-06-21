import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PairModal } from '../src/components/PairModal'
import { useStore } from '@trux/client/store'

afterEach(() => {
  cleanup()
  localStorage.clear()
  useStore.setState({ tailscaleHost: null })
})

describe('PairModal', () => {
  it('renders a QR when a tailscale host and token are present', () => {
    useStore.setState({ tailscaleHost: 'box.tail123.ts.net' })
    localStorage.setItem('trux_token', 'secret-token')
    render(<PairModal onClose={() => {}} />)
    expect(screen.getByTestId('pair-qr')).toBeInTheDocument()
    expect(screen.queryByTestId('pair-unavailable')).toBeNull()
  })

  it('shows the unavailable message when the tailscale host is missing', () => {
    useStore.setState({ tailscaleHost: null })
    localStorage.setItem('trux_token', 'secret-token')
    render(<PairModal onClose={() => {}} />)
    expect(screen.getByTestId('pair-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('pair-qr')).toBeNull()
  })

  it('shows the unavailable message when the token is missing', () => {
    useStore.setState({ tailscaleHost: 'box.tail123.ts.net' })
    render(<PairModal onClose={() => {}} />)
    expect(screen.getByTestId('pair-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('pair-qr')).toBeNull()
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    useStore.setState({ tailscaleHost: 'box.tail123.ts.net' })
    localStorage.setItem('trux_token', 'secret-token')
    render(<PairModal onClose={onClose} />)
    fireEvent.click(screen.getByTestId('pair-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
