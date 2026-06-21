import { render, screen, fireEvent } from '@testing-library/react-native'
import type { AgentCommand } from '@trux/protocol'

// Recents are read/written through the shared Storage port; a simple in-memory
// fake keeps the palette deterministic.
jest.mock('@trux/client/ports', () => {
  const store = new Map<string, string>()
  return {
    getStorage: () => ({
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => store.set(k, v),
      remove: (k: string) => store.delete(k),
    }),
  }
})

jest.mock('../haptics', () => ({ haptic: jest.fn() }))

import { CommandPalette } from './CommandPalette'

const commands: AgentCommand[] = [
  { name: 'review', description: 'Review the diff', body: 'Please review my changes.', args: [], source: 'file' },
  {
    name: 'fix',
    description: 'Fix an issue',
    body: 'Fix $ARGUMENTS now.',
    args: [{ name: 'ARGUMENTS', label: 'What to fix', required: true }],
    source: 'file',
  },
]

describe('CommandPalette', () => {
  it('lists commands and filters by search query', async () => {
    await render(<CommandPalette agent="claude" commands={commands} visible onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByText('/review')).toBeTruthy()
    expect(screen.getByText('/fix')).toBeTruthy()
    await fireEvent.changeText(screen.getByPlaceholderText('Search commands…'), 'review')
    expect(screen.getByText('/review')).toBeTruthy()
    expect(screen.queryByText('/fix')).toBeNull()
  })

  it('runs a no-arg command immediately with its resolved body', async () => {
    const onPick = jest.fn()
    const onClose = jest.fn()
    await render(<CommandPalette agent="claude" commands={commands} visible onPick={onPick} onClose={onClose} />)
    await fireEvent.press(screen.getByText('/review'))
    expect(onPick).toHaveBeenCalledWith('Please review my changes.')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an arg form for a parameterized command and resolves it on insert', async () => {
    const onPick = jest.fn()
    await render(<CommandPalette agent="claude" commands={commands} visible onPick={onPick} onClose={() => {}} />)
    await fireEvent.press(screen.getByText('/fix'))
    // Arg form now shows the command title and the labelled field.
    expect(screen.getByText('/fix')).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('What to fix'), 'the auth bug')
    await fireEvent.press(screen.getByText('Insert'))
    expect(onPick).toHaveBeenCalledWith('Fix the auth bug now.')
  })

  it('shows an empty state when no commands match', async () => {
    await render(<CommandPalette agent="claude" commands={commands} visible onPick={() => {}} onClose={() => {}} />)
    await fireEvent.changeText(screen.getByPlaceholderText('Search commands…'), 'zzz')
    expect(screen.getByText('No commands')).toBeTruthy()
  })
})
