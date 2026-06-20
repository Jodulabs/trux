import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NewConversationDialog } from '../src/components/NewConversationDialog'
import { api } from '../src/api'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('NewConversationDialog folder picker', () => {
  it('lists projects and creates a conversation in the chosen folder', async () => {
    vi.spyOn(api, 'listWorkspaces').mockResolvedValue([
      { name: 'repo', root: '/r', worktrees: [{ path: '/r', branch: 'main' }] },
      { name: 'trux', root: '/t', worktrees: [
        { path: '/t', branch: 'main' },
        { path: '/t-feat', branch: 'feat' },
      ] },
    ])
    vi.spyOn(api, 'listAgents').mockResolvedValue({
      agents: [{ agent: 'claude', models: [], defaultModel: null, controls: [] }],
    })
    vi.spyOn(api, 'discoverSessions').mockResolvedValue([])
    const created = vi.spyOn(api, 'createConversation').mockResolvedValue({
      id: 'c1', agent: 'claude', cwd: '/t-feat', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
      model: null, options: {},
    })

    render(<NewConversationDialog onCreated={() => {}} />)

    // The single-worktree project shows as one row; the multi-worktree project
    // nests its worktrees, so a specific branch folder is selectable.
    await waitFor(() => expect(screen.getByTestId('folder-/t-feat')).toBeTruthy())
    fireEvent.click(screen.getByTestId('folder-/t-feat'))
    fireEvent.click(screen.getByTestId('create'))

    await waitFor(() =>
      expect(created).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'claude', cwd: '/t-feat', model: null, options: {} }),
      ),
    )
  })

  it('filters the list by search query', async () => {
    vi.spyOn(api, 'listWorkspaces').mockResolvedValue([
      { name: 'alpha', root: '/a', worktrees: [{ path: '/a', branch: 'main' }] },
      { name: 'beta', root: '/b', worktrees: [{ path: '/b', branch: 'main' }] },
    ])
    vi.spyOn(api, 'listAgents').mockResolvedValue({
      agents: [{ agent: 'claude', models: [], defaultModel: null, controls: [] }],
    })
    vi.spyOn(api, 'discoverSessions').mockResolvedValue([])

    render(<NewConversationDialog onCreated={() => {}} />)

    await waitFor(() => expect(screen.getByTestId('folder-/a')).toBeTruthy())
    fireEvent.change(screen.getByTestId('folder-search'), { target: { value: 'beta' } })

    expect(screen.queryByTestId('folder-/a')).toBeNull()
    expect(screen.getByTestId('folder-/b')).toBeTruthy()
  })
})
