import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ApprovalRequestEvent } from '@trux/protocol'
import { Composer } from '../src/components/Composer'
import { Transcript } from '../src/components/Transcript'
import { ApprovalCard } from '../src/components/ApprovalCard'
import { ConversationView, deriveTitle } from '../src/components/ConversationView'
import { ConversationList } from '../src/components/ConversationList'
import { NewConversationDialog } from '../src/components/NewConversationDialog'
import { api } from '../src/api'
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
  it('renders user and assistant items, and folds tool activity', () => {
    const items: TranscriptItem[] = [
      { type: 'user_text', turn_id: 't1', text: 'hello' },
      { type: 'text', turn_id: 't1', text: 'hi back' },
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls' } },
    ]
    // running → the activity group is open, so the tool name shows
    render(<Transcript items={items} approvalDecisions={{}} onRespond={() => {}} status="thinking" />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi back')).toBeInTheDocument()
    expect(screen.getByTestId('activity-group')).toBeInTheDocument()
    expect(screen.getAllByText(/Bash/).length).toBeGreaterThan(0)
  })

  it('collapses a settled tool group and expands it on tap', () => {
    const items: TranscriptItem[] = [
      { type: 'tool_call', turn_id: 't1', tool_id: 'x', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'file.txt' },
    ]
    // not running → collapsed: output hidden until the header is tapped
    render(<Transcript items={items} approvalDecisions={{}} onRespond={() => {}} status="idle" />)
    expect(screen.queryByText('file.txt')).toBeNull()
    fireEvent.click(screen.getByTestId('activity-toggle'))
    expect(screen.getByText('file.txt')).toBeInTheDocument()
  })

  it('renders an inline image for a tool_result with images', () => {
    const items: TranscriptItem[] = [
      {
        type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'shot',
        images: [{ kind: 'image', media_type: 'image/png', data: 'AAAA' }],
      },
    ]
    // running → open, so the image renders
    render(<Transcript items={items} approvalDecisions={{}} onRespond={() => {}} status="thinking" />)
    const img = screen.getByTestId('tool-image') as HTMLImageElement
    expect(img.src).toContain('data:image/png;base64,AAAA')
  })
})

describe('ApprovalCard', () => {
  const event: ApprovalRequestEvent = {
    type: 'approval_request', turn_id: 't1', request_id: 'tu_1', tool: 'Bash', input: { command: 'ls' },
  }

  it('renders graduated Bash actions and calls onRespond', () => {
    const onRespond = vi.fn()
    render(<ApprovalCard event={event} onRespond={onRespond} />)
    // Bash gets Allow once / Allow this command / Deny.
    expect(screen.getByTestId('approve-command')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('approve-allow'))
    expect(onRespond).toHaveBeenCalledWith('tu_1', 'allow')
    fireEvent.click(screen.getByTestId('approve-command'))
    expect(onRespond).toHaveBeenCalledWith('tu_1', 'allow_command')
  })

  it('renders "Allow all edits" for an Edit tool', () => {
    const editEvent: ApprovalRequestEvent = {
      type: 'approval_request', turn_id: 't1', request_id: 'tu_2', tool: 'Write', input: { file_path: 'a.ts' },
    }
    const onRespond = vi.fn()
    render(<ApprovalCard event={editEvent} onRespond={onRespond} />)
    fireEvent.click(screen.getByTestId('approve-edits'))
    expect(onRespond).toHaveBeenCalledWith('tu_2', 'allow_edits')
    // The one approved thing is surfaced structurally, not as JSON only.
    expect(screen.getByTestId('approval-subject')).toHaveTextContent('a.ts')
  })

  it('shows the chosen decision and disables the buttons (decision history)', () => {
    render(<ApprovalCard event={event} decision="deny" onRespond={() => {}} />)
    expect(screen.getByTestId('approval-decided')).toHaveTextContent('deny')
    // Buttons stay rendered (lit/dimmed) but are disabled.
    const allow = screen.getByTestId('approve-allow')
    expect(allow).toBeDisabled()
    expect(screen.getByTestId('approve-deny')).toHaveClass('chosen')
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

describe('NewConversationDialog', () => {
  it('renders fetched agents and creates with the selected one', async () => {
    vi.spyOn(api, 'listWorkspaces').mockResolvedValue([
      { name: 'repo', root: '/repo', worktrees: [{ path: '/repo', branch: 'main' }] },
    ])
    vi.spyOn(api, 'listAgents').mockResolvedValue({
      agents: [
        { agent: 'claude', models: [], defaultModel: null, controls: [] },
        { agent: 'opencode', models: [], defaultModel: null, controls: [] },
      ],
    })
    vi.spyOn(api, 'discoverSessions').mockResolvedValue([])
    const created = vi.spyOn(api, 'createConversation').mockResolvedValue({
      id: 'c1', agent: 'opencode', cwd: '/repo', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
      model: null, options: {},
    })
    const onCreated = vi.fn()
    render(<NewConversationDialog onCreated={onCreated} />)
    const agentSelect = await screen.findByTestId('agent-select')
    fireEvent.change(agentSelect, { target: { value: 'opencode' } })
    fireEvent.click(screen.getByTestId('create'))
    await waitFor(() => expect(created).toHaveBeenCalledWith(expect.objectContaining({ agent: 'opencode', cwd: '/repo' })))
    vi.restoreAllMocks()
  })

  it('shows a single-worktree repo as one row and nests a multi-worktree repo', async () => {
    useStore.setState({ conversations: [] })
    vi.spyOn(api, 'listWorkspaces').mockResolvedValue([
      { name: 'solo', root: '/solo', worktrees: [{ path: '/solo', branch: 'main' }] },
      {
        name: 'multi',
        root: '/multi',
        worktrees: [
          { path: '/multi', branch: 'main' },
          { path: '/multi/.worktrees/feat', branch: 'feat' },
        ],
      },
    ])
    vi.spyOn(api, 'listAgents').mockResolvedValue({
      agents: [{ agent: 'claude', models: [], defaultModel: null, controls: [] }],
    })
    vi.spyOn(api, 'discoverSessions').mockResolvedValue([])
    const created = vi.spyOn(api, 'createConversation').mockResolvedValue({
      id: 'c2', agent: 'claude', cwd: '/multi/.worktrees/feat', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
      model: null, options: {},
    })
    render(<NewConversationDialog onCreated={vi.fn()} />)
    // 'solo' has one worktree → a single selectable row, no separate header.
    await screen.findByTestId('folder-/solo')
    expect(screen.getByText('multi')).toBeTruthy() // 'multi' renders as a group header
    // 'multi' nests its worktrees → the feat worktree is directly selectable.
    // Re-click until the selection sticks: the dialog seeds a default folder
    // asynchronously, so a single click can race that initial render.
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('folder-/multi/.worktrees/feat'))
      expect(screen.getByTestId('folder-/multi/.worktrees/feat').className).toContain('selected')
    })
    fireEvent.click(screen.getByTestId('create'))
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', cwd: '/multi/.worktrees/feat' })),
    )
    vi.restoreAllMocks()
  })
})

describe('deriveTitle', () => {
  it('takes the first line, trims, and caps at 60 chars', () => {
    expect(deriveTitle('Fix the auth redirect\nmore detail')).toBe('Fix the auth redirect')
    expect(deriveTitle('  hello world  ')).toBe('hello world')
    expect(deriveTitle('x'.repeat(80))).toHaveLength(60)
    expect(deriveTitle('')).toBe('')
  })
})

describe('ConversationList', () => {
  it('renders a conversation title once set', () => {
    useStore.setState({
      conversations: [
        { id: 'c1', agent: 'claude', cwd: '/x/darshi', title: 'Fix auth', status: 'idle',
          native_session_id: null, archived: false, created_at: 1, updated_at: 1,
          model: null, options: {} },
      ],
      convMeta: {},
    })
    render(<ConversationList conversations={useStore.getState().conversations} currentId={null} onSelect={() => {}} />)
    expect(screen.getByText('Fix auth')).toBeTruthy()
  })
})
