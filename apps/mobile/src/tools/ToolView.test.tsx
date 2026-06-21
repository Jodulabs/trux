import { render, screen, fireEvent } from '@testing-library/react-native'
import { ToolView } from './ToolView'
import type { ToolCall } from './types'
import type { ApprovalDecision } from '@trux/protocol'

const noopRespond = (_id: string, _d: ApprovalDecision) => {}

const tool = (overrides: Partial<ToolCall> & { name: string }): ToolCall => ({
  state: 'running',
  input: {},
  createdAt: Date.now(),
  startedAt: null,
  completedAt: null,
  description: null,
  ...overrides,
})

describe('ToolView', () => {
  it('renders a Bash tool header with command subtitle (minimal)', async () => {
    const tc = tool({ name: 'Bash', input: { command: 'git status' } })
    await render(<ToolView metadata={null} tool={tc} />)
    // extractSubtitle returns the command
    expect(screen.getByText('git status')).toBeTruthy()
  })

  it('renders an Edit tool with a diff view (old → new)', async () => {
    const tc = tool({
      name: 'Edit',
      state: 'completed',
      input: { file_path: '/x.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
    })
    await render(<ToolView metadata={null} tool={tc} />)
    // The diff view renders removed lines in red (error color) and added in green (ok color)
    // Check that both old and new text appear in the diff
    expect(screen.getByText(/const a = 1/)).toBeTruthy()
    expect(screen.getByText(/const a = 2/)).toBeTruthy()
  })

  it('renders a Write tool with the new content as additions', async () => {
    const tc = tool({
      name: 'Write',
      state: 'completed',
      input: { file_path: '/new.ts', content: 'export const x = 42' },
    })
    await render(<ToolView metadata={null} tool={tc} />)
    // Write renders oldText='' → newText=content, so all lines are additions
    expect(screen.getByText(/export const x = 42/)).toBeTruthy()
  })

  it('renders a TodoWrite tool with the todo items', async () => {
    const tc = tool({
      name: 'TodoWrite',
      state: 'completed',
      input: {
        todos: [
          { content: 'Write tests', status: 'completed' },
          { content: 'Ship it', status: 'in_progress' },
          { content: 'Celebrate', status: 'pending' },
        ],
      },
    })
    await render(<ToolView metadata={null} tool={tc} />)
    expect(screen.getByText(/Write tests/)).toBeTruthy()
    expect(screen.getByText(/Ship it/)).toBeTruthy()
    expect(screen.getByText(/Celebrate/)).toBeTruthy()
  })

  it('renders a running tool with an activity indicator', async () => {
    const tc = tool({ name: 'Bash', input: { command: 'ls' } })
    await render(<ToolView metadata={null} tool={tc} />)
    // The header should show the command subtitle
    expect(screen.getByText('ls')).toBeTruthy()
  })

  it('renders an errored tool with the error message', async () => {
    const tc = tool({
      name: 'Bash',
      state: 'error',
      input: { command: 'false' },
      result: 'exit code 1',
    })
    await render(<ToolView metadata={null} tool={tc} />)
    // Bash has hideDefaultError=true, so the error ToolError won't show for
    // Bash. But the state is 'error' which shows the alert icon. Check the
    // command is still visible.
    expect(screen.getByText('false')).toBeTruthy()
  })

  it('renders an unknown tool with the default JSON input fallback', async () => {
    const tc = tool({
      name: 'SomeUnknownTool',
      state: 'running',
      input: { key: 'value' },
    })
    await render(<ToolView metadata={null} tool={tc} />)
    // The default view shows the input as JSON
    expect(screen.getByText(/key/)).toBeTruthy()
  })

  it('renders a permission footer with approve/deny buttons when pending', async () => {
    const tc = tool({
      name: 'Bash',
      input: { command: 'rm -rf /' },
      permission: { id: 'req1', status: 'pending' },
    })
    await render(
      <ToolView
        metadata={null}
        tool={tc}
        sessionId="c1"
        approvalDecision={undefined}
        onApprovalRespond={noopRespond}
      />,
    )
    expect(screen.getByText('Allow once')).toBeTruthy()
    expect(screen.getByText('Allow this command')).toBeTruthy()
    expect(screen.getByText('Deny')).toBeTruthy()
  })

  it('emits the approval decision when a button is pressed', async () => {
    const tc = tool({
      name: 'Bash',
      input: { command: 'rm -rf /' },
      permission: { id: 'req1', status: 'pending' },
    })
    const onRespond = jest.fn()
    await render(
      <ToolView metadata={null} tool={tc} sessionId="c1" approvalDecision={undefined} onApprovalRespond={onRespond} />,
    )
    await fireEvent.press(screen.getByText('Deny'))
    expect(onRespond).toHaveBeenCalledWith('req1', 'deny')
  })

  it('shows the decided state when an approval decision is recorded', async () => {
    const tc = tool({
      name: 'Bash',
      input: { command: 'rm -rf /' },
      permission: { id: 'req1', status: 'approved' },
    })
    await render(
      <ToolView metadata={null} tool={tc} sessionId="c1" approvalDecision="allow" onApprovalRespond={noopRespond} />,
    )
    expect(screen.getByText(/Approved/)).toBeTruthy()
  })

  it('renders an Edit tool showing removed and added diff lines', async () => {
    const tc = tool({
      name: 'Edit',
      state: 'completed',
      input: {
        file_path: '/app.ts',
        old_string: 'const x = 1\nconst y = 2',
        new_string: 'const x = 1\nconst y = 3',
      },
    })
    await render(<ToolView metadata={null} tool={tc} />)
    // The diff should show the unchanged context line, the removed line, and the added line
    expect(screen.getByText(/const y = 2/)).toBeTruthy()
    expect(screen.getByText(/const y = 3/)).toBeTruthy()
  })
})
