import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Conversation } from '@trux/protocol'
import { useStore } from '@trux/client/store'

// Stub a fake client so ConversationView's onSend can call sendUserMessage.
const sendUserMessage = vi.fn()
const interrupt = vi.fn()
vi.mock('@trux/client/connectionManager', () => ({
  openConnection: vi.fn(),
  setActiveHandlers: vi.fn(),
  clearActiveHandlers: vi.fn(),
  getConnection: () => ({ sendUserMessage, interrupt, close: () => {}, respondApproval: () => {} }),
}))

vi.mock('@trux/client/outbox', () => ({
  enqueue: vi.fn(),
  newMessageId: vi.fn(() => 'cid-1'),
  dequeue: vi.fn(),
}))

import { ConversationView } from '../src/components/ConversationView'
import { api } from '@trux/client/api'

afterEach(() => { cleanup(); vi.restoreAllMocks(); useStore.setState({ conversations: [], convMeta: {}, transcript: [], status: 'idle', approvalDecisions: {} }) })

const claudeConv: Conversation = {
  id: 'c1', agent: 'claude', cwd: '/x', title: null, status: 'idle',
  native_session_id: null, archived: false, created_at: 1, updated_at: 1,
  model: 'claude-sonnet-4-6', options: {},
}

const claudeManifest = {
  agent: 'claude' as const,
  models: [
    { value: 'claude-opus-4-8', label: 'Opus 4.8' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  ],
  defaultModel: null,
  controls: [],
}

beforeEach(() => {
  sendUserMessage.mockReset()
  vi.spyOn(api, 'listAgents').mockResolvedValue({ agents: [claudeManifest] })
  vi.spyOn(api, 'gitStatus').mockResolvedValue({ repo: false })
  vi.spyOn(api, 'renameConversation').mockResolvedValue(claudeConv)
})

describe('ConversationView commands', () => {
  it('fetches commands for the conversation and shows the command button', async () => {
    vi.spyOn(api, 'discoverCommands').mockResolvedValue({
      commands: [{ name: 'ship', description: 'Ship', body: 'Ship it', args: [], source: 'file' }],
    })
    useStore.setState({ conversations: [claudeConv], status: 'idle', approvalDecisions: {}, convMeta: {} })
    render(<ConversationView id="c1" />)
    expect(await screen.findByTestId('cmd-btn')).toBeInTheDocument()
    expect(api.discoverCommands).toHaveBeenCalledWith('claude', expect.any(String))
  })
})

describe('ConversationView composer picker', () => {
  it('seeds the model picker from the conversation sticky selection', async () => {
    useStore.setState({ conversations: [claudeConv], status: 'idle', approvalDecisions: {}, convMeta: {} })
    render(<ConversationView id="c1" />)
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeTruthy())
    const select = screen.getByTestId('model-select') as HTMLSelectElement
    expect(select.value).toBe('claude-sonnet-4-6')
  })

  it('sends the current config with sendUserMessage on submit', async () => {
    useStore.setState({ conversations: [claudeConv], status: 'idle', approvalDecisions: {}, convMeta: {} })
    render(<ConversationView id="c1" />)
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeTruthy())
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByTestId('send'))
    expect(sendUserMessage).toHaveBeenCalledWith(
      'hello',
      undefined,
      'cid-1',
      { model: 'claude-sonnet-4-6', options: {} },
    )
  })

  it('changing the picker updates the config sent on the next submit', async () => {
    useStore.setState({ conversations: [claudeConv], status: 'idle', approvalDecisions: {}, convMeta: {} })
    render(<ConversationView id="c1" />)
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeTruthy())
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-opus-4-8' } })
    const input = screen.getByTestId('composer-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'go' } })
    fireEvent.click(screen.getByTestId('send'))
    expect(sendUserMessage).toHaveBeenCalledWith(
      'go',
      undefined,
      'cid-1',
      { model: 'claude-opus-4-8', options: {} },
    )
  })
})
