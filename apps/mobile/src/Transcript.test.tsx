import { render, screen, fireEvent } from '@testing-library/react-native'
import { Transcript, findLatestPendingApproval, toRows } from './components/Transcript'
import type { TranscriptItem } from '@trux/client/store'
import type { ApprovalDecision } from '@trux/protocol'

const noopRespond = (_id: string, _d: ApprovalDecision) => {}

describe('Transcript', () => {
  it('renders user and assistant text as separate bubbles', async () => {
    const items: TranscriptItem[] = [
      { type: 'user_text', turn_id: 't1', text: 'hello there' },
      { type: 'text', turn_id: 't1', text: 'hi back' },
    ]
    await render(<Transcript items={items} status="idle" approvalDecisions={{}} onRespond={noopRespond} />)
    expect(screen.getByText('hello there')).toBeTruthy()
    expect(screen.getByText('hi back')).toBeTruthy()
  })

  it('renders a Bash tool_call via the tool-view header with command subtitle', async () => {
    const items: TranscriptItem[] = [
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls -la' } },
    ]
    await render(<Transcript items={items} status="thinking" approvalDecisions={{}} onRespond={noopRespond} />)
    expect(screen.getByText('ls -la')).toBeTruthy()
  })

  it('collapses tool groups when idle with a summary header', async () => {
    const items: TranscriptItem[] = [
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'ok' },
      { type: 'tool_call', turn_id: 't1', tool_id: 'y', name: 'Read', input: { file_path: '/a.ts' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'y', status: 'ok', output: 'file' },
    ]
    await render(<Transcript items={items} status="idle" approvalDecisions={{}} onRespond={noopRespond} />)
    expect(screen.getByText(/2 steps/)).toBeTruthy()
    expect(screen.getByText(/Worked/)).toBeTruthy()
  })

  it('renders an approval_request card with tool name + summary + buttons', async () => {
    const items: TranscriptItem[] = [
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'rm -rf /' } },
    ]
    await render(<Transcript items={items} status="awaiting_approval" approvalDecisions={{}} onRespond={noopRespond} />)
    expect(screen.getByText(/Approve/)).toBeTruthy()
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('rm -rf /')).toBeTruthy()
    expect(screen.getByText('Allow once')).toBeTruthy()
    expect(screen.getByText('Allow this command')).toBeTruthy()
    expect(screen.getByText('Deny')).toBeTruthy()
  })

  it('hides pending approvals when hidePendingApprovals is set', async () => {
    const items: TranscriptItem[] = [
      { type: 'user_text', turn_id: 't1', text: 'do it' },
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'rm -rf /' } },
    ]
    await render(
      <Transcript
        items={items}
        status="awaiting_approval"
        approvalDecisions={{}}
        onRespond={noopRespond}
        hidePendingApprovals
      />,
    )
    expect(screen.getByText('do it')).toBeTruthy()
    expect(screen.queryByText('Allow once')).toBeNull()
  })

  it('shows the decision when an approval has been responded to', async () => {
    const items: TranscriptItem[] = [
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'rm -rf /' } },
    ]
    await render(
      <Transcript
        items={items}
        status="awaiting_approval"
        approvalDecisions={{ tu_1: 'allow' }}
        onRespond={noopRespond}
      />,
    )
    expect(screen.getByText(/Approved \(allow\)/)).toBeTruthy()
  })

  it('shows a streaming caret while thinking on the latest assistant text', async () => {
    const items: TranscriptItem[] = [
      { type: 'text', turn_id: 't1', text: 'partial' },
    ]
    await render(<Transcript items={items} status="thinking" approvalDecisions={{}} onRespond={noopRespond} />)
    expect(screen.getByLabelText('Streaming')).toBeTruthy()
  })

  it('findLatestPendingApproval returns the newest unresolved approval', () => {
    const items: TranscriptItem[] = [
      { type: 'approval_request', turn_id: 't1', request_id: 'a1', tool: 'Bash', input: { command: 'one' } },
      { type: 'approval_request', turn_id: 't1', request_id: 'a2', tool: 'Edit', input: { file_path: 'x' } },
    ]
    expect(findLatestPendingApproval(items, { a1: 'allow' })?.requestId).toBe('a2')
    expect(findLatestPendingApproval(items, { a1: 'allow', a2: 'deny' })).toBeNull()
  })

  it('toRows marks the last assistant row as streaming', () => {
    const items: TranscriptItem[] = [
      { type: 'text', turn_id: 't1', text: 'a' },
      { type: 'text', turn_id: 't1', text: 'b' },
    ]
    const rows = toRows(items, {}, { streaming: true })
    const assistants = rows.filter((r) => r.kind === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants[0].streaming).toBeUndefined()
    expect(assistants[1]).toMatchObject({ streaming: true })
  })

  it('expands a collapsed tool group on press', async () => {
    const items: TranscriptItem[] = [
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'echo hi' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'hi' },
    ]
    await render(<Transcript items={items} status="idle" approvalDecisions={{}} onRespond={noopRespond} />)
    await fireEvent.press(screen.getByLabelText('Expand tool activity'))
    expect(screen.getByText('echo hi')).toBeTruthy()
  })
})
