import { render, screen } from '@testing-library/react-native'
import { Transcript } from './components/Transcript'
import type { TranscriptItem } from '@trux/client/store'

describe('Transcript', () => {
  it('renders user and assistant text as separate bubbles', async () => {
    const items: TranscriptItem[] = [
      { type: 'user_text', turn_id: 't1', text: 'hello there' },
      { type: 'text', turn_id: 't1', text: 'hi back' },
    ]
    await render(<Transcript items={items} status="idle" />)
    expect(screen.getByText('hello there')).toBeTruthy()
    expect(screen.getByText('hi back')).toBeTruthy()
  })

  it('summarises a tool_call with its name + one-line input', async () => {
    const items: TranscriptItem[] = [
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls -la' } },
    ]
    await render(<Transcript items={items} status="thinking" />)
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('ls -la')).toBeTruthy()
  })

  it('folds an adjacent tool_result into the tool row', async () => {
    const items: TranscriptItem[] = [
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Read', input: { file_path: '/a.ts' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'contents' },
    ]
    await render(<Transcript items={items} status="idle" />)
    expect(screen.getByText('Read')).toBeTruthy()
    // the result status is appended to the sub line
    expect(screen.getByText('/a.ts · ok')).toBeTruthy()
  })

  it('flags an approval_request with the awaiting-approval tag', async () => {
    const items: TranscriptItem[] = [
      { type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'rm -rf /' } },
    ]
    await render(<Transcript items={items} status="awaiting_approval" />)
    expect(screen.getByText('awaiting approval')).toBeTruthy()
    expect(screen.getByText('rm -rf /')).toBeTruthy()
  })
})
