import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import type { GitStatusResult } from '@trux/protocol'

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('../haptics', () => ({ haptic: jest.fn() }))

// api mocked with jest.fn()s created inside the factory (exist at factory-eval
// time, before module-scope consts), then grabbed via the import below.
jest.mock('@trux/client/api', () => ({
  api: {
    gitStatus: jest.fn(),
    gitDiff: jest.fn(),
    gitStage: jest.fn(),
    gitUnstage: jest.fn(),
    gitCommit: jest.fn(),
  },
}))

import { api } from '@trux/client/api'
import { GitPanel } from './GitPanel'

const mockApi = api as unknown as {
  gitStatus: jest.Mock
  gitDiff: jest.Mock
  gitStage: jest.Mock
  gitUnstage: jest.Mock
  gitCommit: jest.Mock
}

const dirtyStatus: GitStatusResult = {
  repo: true,
  branch: 'main',
  ahead: 1,
  behind: 0,
  dirty: true,
  files: [
    { path: 'src/staged.ts', index: 'M', work: ' ', staged: true },
    { path: 'src/changed.ts', index: ' ', work: 'M', staged: false },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockApi.gitStatus.mockResolvedValue(dirtyStatus)
  mockApi.gitDiff.mockResolvedValue({ diff: '@@ -1 +1 @@\n-old\n+new' })
  mockApi.gitStage.mockResolvedValue({ ok: true })
  mockApi.gitUnstage.mockResolvedValue({ ok: true })
  mockApi.gitCommit.mockResolvedValue({ ok: true, hash: 'abc1234' })
})

describe('GitPanel', () => {
  it('loads status and shows staged + unstaged files with the branch', async () => {
    await render(<GitPanel conversationId="c1" visible onClose={() => {}} />)
    expect(await screen.findByText('src/staged.ts')).toBeTruthy()
    expect(screen.getByText('src/changed.ts')).toBeTruthy()
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('Staged')).toBeTruthy()
    expect(screen.getByText('Changes')).toBeTruthy()
  })

  it('stages an unstaged file via the toggle button', async () => {
    await render(<GitPanel conversationId="c1" visible onClose={() => {}} />)
    await screen.findByText('src/changed.ts')
    await fireEvent.press(screen.getByLabelText('Stage src/changed.ts'))
    await waitFor(() => expect(mockApi.gitStage).toHaveBeenCalledWith('c1', 'src/changed.ts'))
  })

  it('unstages a staged file via the toggle button', async () => {
    await render(<GitPanel conversationId="c1" visible onClose={() => {}} />)
    await screen.findByText('src/staged.ts')
    await fireEvent.press(screen.getByLabelText('Unstage src/staged.ts'))
    await waitFor(() => expect(mockApi.gitUnstage).toHaveBeenCalledWith('c1', 'src/staged.ts'))
  })

  it('commits the staged changes with the entered message', async () => {
    await render(<GitPanel conversationId="c1" visible onClose={() => {}} />)
    await screen.findByText('src/staged.ts')
    await fireEvent.changeText(screen.getByPlaceholderText('Commit message…'), 'fix: the thing')
    await fireEvent.press(screen.getByText('Commit staged'))
    await waitFor(() => expect(mockApi.gitCommit).toHaveBeenCalledWith('c1', 'fix: the thing'))
    expect(await screen.findByText('Committed abc1234')).toBeTruthy()
  })

  it('shows the not-a-repo state', async () => {
    mockApi.gitStatus.mockResolvedValue({ repo: false })
    await render(<GitPanel conversationId="c1" visible onClose={() => {}} />)
    expect(await screen.findByText('Not a git repository.')).toBeTruthy()
  })
})
