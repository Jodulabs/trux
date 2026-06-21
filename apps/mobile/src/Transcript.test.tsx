import { render, screen } from '@testing-library/react-native'
import { Transcript } from './components/Transcript'
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
    // The ToolView header shows the command as the subtitle (extractSubtitle)
    expect(screen.getByText('ls -la')).toBeTruthy()
  })

  it('renders an unknown tool via the default JSON fallback', async () => {
    const items: TranscriptItem[] = [
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Read', input: { file_path: '/a.ts' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'file contents here' },
    ]
    await render(<Transcript items={items} status="idle" approvalDecisions={{}} onRespond={noopRespond} />)
    // Read is not in the 4-tool registry; the default view shows the tool name as header
    expect(screen.getByText('Read')).toBeTruthy()
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
    expect(screen.getByText(/You chose: allow/)).toBeTruthy()
  })
})
