import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewConversationDialog } from '../src/components/NewConversationDialog'
import { api } from '../src/api'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('NewConversationDialog model picker', () => {
  it('renders the model picker and sends the selection on create', async () => {
    vi.spyOn(api, 'listWorkspaces').mockResolvedValue([
      { name: 'repo', root: '/r', worktrees: [{ path: '/r', branch: 'main' }] },
    ])
    vi.spyOn(api, 'listAgents').mockResolvedValue({
      agents: [
        {
          agent: 'claude',
          models: [{ value: 'claude-opus-4-8', label: 'Opus 4.8' }],
          defaultModel: null,
          controls: [],
        },
      ],
    })
    vi.spyOn(api, 'discoverSessions').mockResolvedValue([])
    const created = vi.spyOn(api, 'createConversation').mockResolvedValue({
      id: 'c1', agent: 'claude', cwd: '/r', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
      model: 'claude-opus-4-8', options: {},
    })
    render(<NewConversationDialog onCreated={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('model-select')).toBeTruthy())
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-opus-4-8' } })
    fireEvent.click(screen.getByTestId('create'))
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'claude', model: 'claude-opus-4-8', options: {} }),
      ),
    )
  })
})
