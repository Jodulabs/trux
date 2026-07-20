import { describe, expect, it } from 'vitest'
import type {
  AgentCapabilities,
  AgentsResponse,
  Conversation,
  CreateConversationRequest,
  PortDetectedEvent,
  ServerEvent,
  StoredEvent,
  ToolResultEvent,
  TurnConfig,
  Workspace,
} from '../src/index'

describe('rest dtos', () => {
  it('builds a Conversation and Workspace', () => {
    const ws: Workspace = { name: 'repo', root: '/repo', worktrees: [{ path: '/repo', branch: 'main' }] }
    const conv: Conversation = {
      id: 'c1', agent: 'claude', cwd: '/repo', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
      model: null, options: {}, trust: null,
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

describe('capability manifest + selection contracts', () => {
  it('an AgentCapabilities manifest carries models + opaque controls', () => {
    const claude: AgentCapabilities = {
      agent: 'claude',
      models: [{ value: 'claude-opus-4-8', label: 'Opus 4.8' }],
      defaultModel: null,
      controls: [
        { key: 'effort', label: 'Effort', options: [{ value: 'high', label: 'High' }], default: '' },
      ],
    }
    const resp: AgentsResponse = { agents: [claude] }
    expect(resp.agents[0]?.models[0]?.value).toBe('claude-opus-4-8')
    expect(resp.agents[0]?.controls[0]?.key).toBe('effort')
    expect(resp.agents[0]?.defaultModel).toBeNull()
  })

  it('TurnConfig has a first-class model, an opaque options bag, and a separate trust field', () => {
    const cfg: TurnConfig = { model: 'claude-opus-4-8', options: { effort: 'high' }, trust: 'allow_all' }
    expect(cfg.model).toBe('claude-opus-4-8')
    expect(cfg.options.effort).toBe('high')
    expect(cfg.trust).toBe('allow_all')
  })

  it('create request and conversation carry the selection', () => {
    const req: CreateConversationRequest = { agent: 'claude', cwd: '/x', model: null, options: {}, trust: 'allow_all' }
    const conv: Conversation = {
      id: 'c1', agent: 'claude', cwd: '/x', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 0, updated_at: 0,
      model: 'claude-opus-4-8', options: { effort: 'high' }, trust: 'allow_all',
    }
    expect(req.options).toEqual({})
    expect(req.trust).toBe('allow_all')
    expect(conv.model).toBe('claude-opus-4-8')
    expect(conv.trust).toBe('allow_all')
  })
})
