import { render, screen } from '@testing-library/react-native'
import { useStore } from '@trux/client/store'
import type { Conversation } from '@trux/protocol'
import SessionScreen from './[id]'

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'c1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}))

jest.mock('../../../src/hooks/useIsDesktop', () => ({
  useIsDesktop: () => false,
}))

jest.mock('../../../src/components/TerminalPane', () => ({
  TerminalPane: () => null,
}))
jest.mock('../../../src/components/PreviewPane', () => ({
  PreviewPane: () => null,
}))
jest.mock('../../../src/components/GitPanel', () => ({
  GitPanel: () => null,
}))
jest.mock('../../../src/components/ConversationView', () => ({
  ConversationView: () => null,
}))

jest.mock('@trux/client/api', () => ({
  api: {
    gitStatus: jest.fn().mockResolvedValue({ repo: false }),
    getCatalog: jest.fn().mockResolvedValue({ catalog: [] }),
  },
}))

const { api } = jest.requireMock('@trux/client/api') as { api: { gitStatus: jest.Mock; getCatalog: jest.Mock } }

const conv = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  agent: 'claude',
  cwd: '/repo/x',
  title: 'Fix auth',
  status: 'idle',
  native_session_id: null,
  archived: false,
  created_at: 1,
  updated_at: 1,
  model: null,
  options: {},
  trust: null,
  account_id: null,
  project_id: null,
  ...overrides,
})

beforeEach(() => {
  useStore.setState({ conversations: [], convMeta: {}, currentId: null, previewPort: null })
  api.gitStatus.mockResolvedValue({ repo: false })
  api.getCatalog.mockResolvedValue({ catalog: [] })
})

describe('SessionScreen', () => {
  it('renders the title, agent·model chip, and status dot', async () => {
    useStore.setState({
      conversations: [conv({ agent: 'pi', model: 'opencode-go/glm-5.2' })],
    })
    await render(<SessionScreen />)
    expect(screen.getByText('Fix auth')).toBeTruthy()
    expect(screen.getByText(/pi · opencode-go\/glm-5\.2/)).toBeTruthy()
  })

  it('shows "default" in the chip when no model is set', async () => {
    useStore.setState({ conversations: [conv({ model: null })] })
    await render(<SessionScreen />)
    expect(screen.getByText(/claude · default/)).toBeTruthy()
  })

  it('exposes awaiting_approval status on the status dot', async () => {
    useStore.setState({
      conversations: [conv({ status: 'awaiting_approval' })],
      convMeta: { c1: { status: 'awaiting_approval', unread: 0, connState: 'connected', lastSeq: -1, totalCost: 0 } },
    })
    await render(<SessionScreen />)
    expect(screen.getByLabelText('Status: Needs approval')).toBeTruthy()
  })

  it('renders the account banner when the agent account is disconnected', async () => {
    useStore.setState({ conversations: [conv({ agent: 'claude' })] })
    api.getCatalog.mockResolvedValue({
      catalog: [{
        agent: 'claude',
        installed: true,
        runnable: false,
        accounts: [{ id: 'claude:default', agent: 'claude', label: 'Default', kind: 'subscription', status: 'disconnected', selected: true }],
        capabilities: { agent: 'claude', models: [], defaultModel: null, controls: [] },
      }],
    })
    await render(<SessionScreen />)
    expect(screen.getByText(/claude account disconnected/)).toBeTruthy()
  })

  it('does not render the account banner when connected', async () => {
    useStore.setState({ conversations: [conv({ agent: 'claude' })] })
    api.getCatalog.mockResolvedValue({
      catalog: [{
        agent: 'claude',
        installed: true,
        runnable: true,
        accounts: [{ id: 'claude:default', agent: 'claude', label: 'Default', kind: 'subscription', status: 'connected', selected: true }],
        capabilities: { agent: 'claude', models: [], defaultModel: null, controls: [] },
      }],
    })
    await render(<SessionScreen />)
    expect(screen.queryByText(/account/)).toBeNull()
  })
})
