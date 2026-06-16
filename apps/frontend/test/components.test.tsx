import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ApprovalRequestEvent } from '@trux/protocol'
import { Composer } from '../src/components/Composer'
import { Transcript } from '../src/components/Transcript'
import { ApprovalCard } from '../src/components/ApprovalCard'
import type { TranscriptItem } from '../src/store'

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
