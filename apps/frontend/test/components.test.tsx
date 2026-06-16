import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Composer } from '../src/components/Composer'
import { Transcript } from '../src/components/Transcript'
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
    render(<Transcript items={items} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi back')).toBeInTheDocument()
    expect(screen.getByText(/Bash/)).toBeInTheDocument()
  })
})
