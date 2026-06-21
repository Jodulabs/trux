import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { useStore } from '@trux/client/store'
import type { AgentCapabilities, Workspace } from '@trux/protocol'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  Redirect: () => null,
  Stack: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('../../src/haptics', () => ({ haptic: jest.fn() }))

const workspaces: Workspace[] = [
  { name: 'trux', root: '/home/gp/trux', worktrees: [{ path: '/home/gp/trux', branch: 'main' }] },
  { name: 'webapp', root: '/home/gp/webapp', worktrees: [{ path: '/home/gp/webapp', branch: 'main' }] },
]

const agents: AgentCapabilities[] = [
  { agent: 'claude', models: [], defaultModel: null, controls: [] },
]

// Mock the api module. The jest.fn()s are created INSIDE the factory so they
// exist at factory-eval time — which, after babel hoists `import './new'`
// above this file's `const` initializers, happens before any module-scope
// variable is assigned. We then grab a stable reference to the mocked object
// via the import below (`mockApi`), and configure resolved values per-test.
jest.mock('@trux/client/api', () => ({
  api: {
    listWorkspaces: jest.fn(),
    listAgents: jest.fn(),
    discoverSessions: jest.fn(),
    createConversation: jest.fn(),
  },
}))

import { api } from '@trux/client/api'
import NewConversationScreen from './new'

const mockApi = api as unknown as {
  listWorkspaces: jest.Mock
  listAgents: jest.Mock
  discoverSessions: jest.Mock
  createConversation: jest.Mock
}

describe('NewConversationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApi.listWorkspaces.mockResolvedValue(workspaces)
    mockApi.listAgents.mockResolvedValue({ agents })
    mockApi.discoverSessions.mockResolvedValue([])
    mockApi.createConversation.mockResolvedValue({ id: 'conv-new' })
    useStore.setState({
      conversations: [],
      loadConversations: jest.fn().mockResolvedValue(undefined),
      selectConversation: jest.fn().mockResolvedValue(undefined),
    })
  })

  it('renders the folder picker with projects', async () => {
    await render(<NewConversationScreen />)
    expect(await screen.findByText('trux')).toBeTruthy()
    expect(screen.getByText('webapp')).toBeTruthy()
  })

  it('selects a folder on tap', async () => {
    await render(<NewConversationScreen />)
    const truxRow = await screen.findByText('trux')
    await fireEvent.press(truxRow)
    expect(screen.getByText('/home/gp/trux')).toBeTruthy()
  })

  it('creates a conversation on tap', async () => {
    await render(<NewConversationScreen />)
    const truxRow = await screen.findByText('trux')
    await fireEvent.press(truxRow)
    await fireEvent.press(screen.getByText('+ New conversation'))
    await waitFor(() => {
      expect(mockApi.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'claude', cwd: '/home/gp/trux' }),
      )
    })
  })

  it('filters folders by search query', async () => {
    await render(<NewConversationScreen />)
    await screen.findByText('trux')
    const search = screen.getByPlaceholderText('Search projects and folders…')
    await fireEvent.changeText(search, 'webapp')
    expect(screen.getByText('webapp')).toBeTruthy()
  })
})
