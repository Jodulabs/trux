import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AgentCommand } from '@trux/protocol'
import { CommandPalette } from '../src/components/CommandPalette'

afterEach(cleanup)

const cmds: AgentCommand[] = [
  { name: 'ship', description: 'Ship to prod', body: 'Ship it now', args: [], source: 'file' },
  { name: 'review', description: 'Review code', body: 'Review $ARGUMENTS', args: [{ name: 'ARGUMENTS', label: 'What', required: true }], source: 'file' },
]

describe('CommandPalette', () => {
  it('lists commands and filters by query', () => {
    render(<CommandPalette agent="claude" commands={cmds} onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('command-ship')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('command-search'), { target: { value: 'rev' } })
    expect(screen.queryByTestId('command-ship')).toBeNull()
    expect(screen.getByTestId('command-review')).toBeInTheDocument()
  })

  it('picks a no-arg command immediately with its resolved body', () => {
    const onPick = vi.fn(); const onClose = vi.fn()
    render(<CommandPalette agent="claude" commands={cmds} onPick={onPick} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('command-ship'))
    expect(onPick).toHaveBeenCalledWith('Ship it now')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an arg form and resolves with the entered value', () => {
    const onPick = vi.fn()
    render(<CommandPalette agent="claude" commands={cmds} onPick={onPick} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('command-review'))
    fireEvent.change(screen.getByTestId('arg-ARGUMENTS'), { target: { value: 'the diff' } })
    fireEvent.click(screen.getByTestId('command-run'))
    expect(onPick).toHaveBeenCalledWith('Review the diff')
  })

  it('renders an empty state when there are no commands', () => {
    render(<CommandPalette agent="claude" commands={[]} onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('command-empty')).toBeInTheDocument()
  })
})
