import { describe, expect, it } from 'vitest'
import type { Conversation, ServerEvent, StoredEvent, Workspace } from '../src/index'

describe('rest dtos', () => {
  it('builds a Conversation and Workspace', () => {
    const ws: Workspace = { root: '/repo', worktrees: [{ path: '/repo', branch: 'main' }] }
    const conv: Conversation = {
      id: 'c1', agent: 'claude', cwd: '/repo', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
    }
    expect(ws.worktrees[0]?.branch).toBe('main')
    expect(conv.agent).toBe('claude')
  })

  it('accepts user_text as a ServerEvent in a StoredEvent', () => {
    const stored: StoredEvent = { seq: 0, event: { type: 'user_text', turn_id: 't1', text: 'hi' } }
    const event: ServerEvent = stored.event
    expect(event.type).toBe('user_text')
  })
})
