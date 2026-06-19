import { describe, expect, it } from 'vitest'
import type {
  AgentsResponse,
  Conversation,
  PortDetectedEvent,
  ServerEvent,
  StoredEvent,
  ToolResultEvent,
  Workspace,
} from '../src/index'

describe('rest dtos', () => {
  it('builds a Conversation and Workspace', () => {
    const ws: Workspace = { name: 'repo', root: '/repo', worktrees: [{ path: '/repo', branch: 'main' }] }
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

describe('phase 3 events', () => {
  it('allows images on a tool_result', () => {
    const ev: ToolResultEvent = {
      type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'shot',
      images: [{ kind: 'image', media_type: 'image/png', data: 'AAAA' }],
    }
    expect(ev.images?.[0]?.media_type).toBe('image/png')
  })

  it('builds a port_detected event', () => {
    const ev: PortDetectedEvent = { type: 'port_detected', port: 5173 }
    expect(ev.port).toBe(5173)
  })
})

describe('agents response', () => {
  it('lists agent names', () => {
    const r: AgentsResponse = { agents: ['claude', 'opencode'] }
    expect(r.agents).toContain('claude')
  })
})
