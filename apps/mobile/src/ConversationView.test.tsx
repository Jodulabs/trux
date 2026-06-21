import { render, screen, fireEvent, act } from '@testing-library/react-native'
import { useStore } from '@trux/client/store'

// Stub the connection manager so no real WebSocket opens. Capture the active
// handlers so the test can simulate a streamed event arriving for the view.
// (jest.mock factories can only reference vars prefixed with `mock`.)
let mockActiveHandlers: { id: string; onEvent: (e: { type: string; [k: string]: unknown }) => void; onConnState: (s: string) => void } | null = null
const mockSendUserMessage = jest.fn()
const mockInterrupt = jest.fn()

jest.mock('@trux/client/connectionManager', () => ({
  openConnection: jest.fn(),
  setActiveHandlers: jest.fn((h: unknown) => { mockActiveHandlers = h as typeof mockActiveHandlers }),
  clearActiveHandlers: jest.fn(() => { mockActiveHandlers = null }),
  getConnection: () => ({ sendUserMessage: mockSendUserMessage, interrupt: mockInterrupt, close: () => {}, respondApproval: () => {} }),
  enqueue: jest.fn(),
}))

jest.mock('@trux/client/outbox', () => ({
  newMessageId: jest.fn(() => 'cid-1'),
  dequeue: jest.fn(),
}))

jest.mock('./haptics', () => ({ haptic: jest.fn() }))

import { ConversationView } from './components/ConversationView'

beforeEach(() => {
  jest.clearAllMocks()
  useStore.setState({ transcript: [], status: 'idle', connState: 'connected', approvalDecisions: {}, convMeta: {} })
  mockActiveHandlers = null
})

describe('ConversationView', () => {
  it('renders the connection-state banner when not connected', async () => {
    useStore.setState({ connState: 'reconnecting' })
    await render(<ConversationView id="c1" onBack={() => {}} />)
    expect(screen.getByText('Reconnecting…')).toBeTruthy()
  })

  it('renders the composer and sends a user message on submit', async () => {
    await render(<ConversationView id="c1" onBack={() => {}} />)
    const input = screen.getByPlaceholderText('Message trux…')
    await fireEvent.changeText(input, 'hello world')
    await fireEvent.press(screen.getByText('↑'))
    // The optimistic bubble appears immediately.
    expect(screen.getByText('hello world')).toBeTruthy()
    expect(mockSendUserMessage).toHaveBeenCalledWith('hello world', undefined, 'cid-1')
  })

  it('folds a streamed text_delta into the transcript via the active handler', async () => {
    useStore.setState({ currentId: 'c1' })
    await render(<ConversationView id="c1" onBack={() => {}} />)
    // Simulate the spine routing a streamed event to the active view. Wrapped in
    // act() so the zustand-driven re-render flushes within React's batch.
    await act(() => {
      mockActiveHandlers?.onEvent({ type: 'text_delta', turn_id: 't1', text: 'Hello' })
      mockActiveHandlers?.onEvent({ type: 'text', turn_id: 't1', text: 'Hello' })
    })
    expect(screen.getByText('Hello')).toBeTruthy()
  })

  it('flips the send button to interrupt while the agent is thinking', async () => {
    useStore.setState({ status: 'thinking' })
    await render(<ConversationView id="c1" onBack={() => {}} />)
    await fireEvent.press(screen.getByText('■'))
    expect(mockInterrupt).toHaveBeenCalled()
  })
})
