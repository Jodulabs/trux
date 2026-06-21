import { render, screen } from '@testing-library/react-native'
import { useStore } from '@trux/client/store'
import type { Conversation } from '@trux/protocol'
import ConversationListScreen from './index'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}))

jest.mock('../../src/ports', () => ({
  getStoredHost: jest.fn(() => 'box.ts.net'),
}))

const conv = (id: string, title: string | null, cwd: string): Conversation => ({
  id,
  agent: 'claude',
  cwd,
  title,
  status: 'idle',
  native_session_id: null,
  archived: false,
  created_at: 1,
  updated_at: 1,
  model: null,
  options: {},
})

beforeEach(() => {
  useStore.setState({ conversations: [], convMeta: {}, currentId: null })
})

describe('ConversationListScreen', () => {
  it('renders a loaded conversation title from the shared store', async () => {
    useStore.setState({
      conversations: [conv('c1', 'Fix auth redirect', '/repo/darshi')],
    })
    await render(<ConversationListScreen />)
    expect(screen.getByText('Fix auth redirect')).toBeTruthy()
  })

  it('shows the empty state greeting when there are no conversations', async () => {
    await render(<ConversationListScreen />)
    expect(screen.getByText('What should we build?')).toBeTruthy()
  })

  it('reflects live status + unread from convMeta', async () => {
    useStore.setState({
      conversations: [conv('c1', 'Running job', '/repo/x')],
      convMeta: { c1: { status: 'thinking', unread: 3, connState: 'connected', lastSeq: -1, totalCost: 0 } },
    })
    await render(<ConversationListScreen />)
    expect(screen.getByText('3')).toBeTruthy() // unread badge
  })
})
