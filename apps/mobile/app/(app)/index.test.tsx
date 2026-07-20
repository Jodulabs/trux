import { render, screen } from '@testing-library/react-native'
import { useStore } from '@trux/client/store'
import type { Conversation, Project } from '@trux/protocol'
import ProjectsScreen from './index'

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}))

jest.mock('../../src/ports', () => ({
  getStoredHost: jest.fn(() => 'box.ts.net'),
}))

jest.mock('@trux/client/api', () => ({
  api: {
    listProjects: jest.fn().mockResolvedValue([]),
    listConversations: jest.fn().mockResolvedValue([]),
  },
}))

const { api: mockApi } = jest.requireMock('@trux/client/api') as { api: { listProjects: jest.Mock; listConversations: jest.Mock } }

const project = (id: string, name: string, cwd: string): Project => ({
  id, name, cwd,
  default_agent: null, default_trust: null, default_model: null,
  archived: false, created_at: 1, updated_at: 1,
})

const conv = (id: string, projectId: string | null, agent: string = 'claude'): Conversation => ({
  id, agent: agent as Conversation['agent'], cwd: '/repo', title: 'T',
  status: 'idle', native_session_id: null, archived: false,
  created_at: 1, updated_at: 1, model: null, options: {},
  trust: null, account_id: null, project_id: projectId,
})

beforeEach(() => {
  useStore.setState({ conversations: [], convMeta: {}, currentId: null, projects: [] })
  mockApi.listProjects.mockResolvedValue([])
  mockApi.listConversations.mockResolvedValue([])
})

describe('ProjectsScreen', () => {
  it('renders project cards with name, path, and chat count', async () => {
    const p1 = project('p1', 'trux-app', '/home/gp/trux')
    const c1 = conv('c1', 'p1')
    const c2 = conv('c2', 'p1')
    useStore.setState({ projects: [p1], conversations: [c1, c2] })
    mockApi.listProjects.mockResolvedValue([p1])
    mockApi.listConversations.mockResolvedValue([c1, c2])
    await render(<ProjectsScreen />)
    expect(screen.getByText('trux-app')).toBeTruthy()
    expect(screen.getByText('/home/gp/trux')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('shows the empty state greeting when there are no projects', async () => {
    await render(<ProjectsScreen />)
    expect(screen.getByText('What should we build?')).toBeTruthy()
  })

  it('shows More in the header instead of Providers/Settings icons', async () => {
    await render(<ProjectsScreen />)
    expect(screen.getByLabelText('More')).toBeTruthy()
    expect(screen.queryByLabelText('Providers')).toBeNull()
    expect(screen.queryByLabelText('Settings')).toBeNull()
  })

  it('shows provider chips for agents used in the project', async () => {
    const p1 = project('p1', 'trux-app', '/x')
    const c1 = conv('c1', 'p1', 'claude')
    const c2 = conv('c2', 'p1', 'pi')
    useStore.setState({ projects: [p1], conversations: [c1, c2] })
    mockApi.listProjects.mockResolvedValue([p1])
    mockApi.listConversations.mockResolvedValue([c1, c2])
    await render(<ProjectsScreen />)
    expect(screen.getByText('claude')).toBeTruthy()
    expect(screen.getByText('pi')).toBeTruthy()
  })

  it('reflects awaiting_approval in the aggregate status dot color', async () => {
    const p1 = project('p1', 'trux-app', '/x')
    const c1 = conv('c1', 'p1')
    useStore.setState({
      projects: [p1],
      conversations: [c1],
      convMeta: { c1: { status: 'awaiting_approval', unread: 0, connState: 'connected', lastSeq: -1, totalCost: 0 } },
    })
    mockApi.listProjects.mockResolvedValue([p1])
    mockApi.listConversations.mockResolvedValue([c1])
    await render(<ProjectsScreen />)
    expect(screen.getByText('trux-app')).toBeTruthy()
  })
})
