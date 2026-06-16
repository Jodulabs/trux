import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ApprovalRequestEvent } from '@trux/protocol'
import { Composer } from '../src/components/Composer'
import { Transcript } from '../src/components/Transcript'
import { ApprovalCard } from '../src/components/ApprovalCard'
import { ConversationView } from '../src/components/ConversationView'
import { useStore, type TranscriptItem } from '../src/store'

afterEach(cleanup)

describe('Composer', () => {
  it('sends trimmed text and clears the box', () => {
    const onSend = vi.fn()
    render(<Composer busy={false} onSend={onSend} onInterrupt={() => {}} />)
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '  hi  ' } })
    fireEvent.click(screen.getByTestId('send'))
    expect(onSend).toHaveBeenCalledWith('hi')
    expect(input.value).toBe('')
  })

  it('shows the interrupt button while busy', () => {
    const onInterrupt = vi.fn()
    render(<Composer busy onSend={() => {}} onInterrupt={onInterrupt} />)
    fireEvent.click(screen.getByTestId('interrupt'))
    expect(onInterrupt).toHaveBeenCalled()
  })
})

describe('Transcript', () => {
  it('renders user, assistant, and tool items', () => {
    const items: TranscriptItem[] = [
      { type: 'user_text', turn_id: 't1', text: 'hello' },
      { type: 'text', turn_id: 't1', text: 'hi back' },
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls' } },
    ]
    render(<Transcript items={items} approvalDecisions={{}} onRespond={() => {}} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi back')).toBeInTheDocument()
    expect(screen.getByText(/Bash/)).toBeInTheDocument()
  })

  it('renders an inline image for a tool_result with images', () => {
    const items: TranscriptItem[] = [
      {
        type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'shot',
        images: [{ kind: 'image', media_type: 'image/png', data: 'AAAA' }],
      },
    ]
    render(<Transcript items={items} approvalDecisions={{}} onRespond={() => {}} />)
    const img = screen.getByTestId('tool-image') as HTMLImageElement
    expect(img.src).toContain('data:image/png;base64,AAAA')
  })
})

describe('ApprovalCard', () => {
  const event: ApprovalRequestEvent = {
    type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' },
  }

  it('renders Allow/Deny/Always and calls onRespond', () => {
    const onRespond = vi.fn()
    render(<ApprovalCard event={event} onRespond={onRespond} />)
    fireEvent.click(screen.getByTestId('approve-allow'))
    expect(onRespond).toHaveBeenCalledWith('tu_1', 'allow')
  })

  it('shows the decided state instead of buttons', () => {
    render(<ApprovalCard event={event} decision="deny" onRespond={() => {}} />)
    expect(screen.getByTestId('approval-decided')).toHaveTextContent('deny')
    expect(screen.queryByTestId('approve-allow')).toBeNull()
  })
})

class NoopWS {
  constructor(public url: string) {}
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

describe('ConversationView preview', () => {
  it('shows Open preview when a port is known and opens it', () => {
    vi.stubGlobal('WebSocket', NoopWS)
    const open = vi.fn()
    vi.stubGlobal('open', open)
    useStore.setState({ previewPort: 5173, transcript: [], status: 'idle', approvalDecisions: {} })
    render(<ConversationView id="c1" />)
    fireEvent.click(screen.getByTestId('open-preview'))
    expect(open).toHaveBeenCalledWith('http://localhost:5173', '_blank')
    vi.unstubAllGlobals()
  })
})
