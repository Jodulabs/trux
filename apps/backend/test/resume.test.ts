import { describe, expect, it } from 'vitest'
import type { Conversation } from '@trux/protocol'
import { buildHandoffCommand, filterConversations } from '../src/resume'

describe('buildHandoffCommand', () => {
  it('returns claude command', () => {
    expect(buildHandoffCommand('claude', 'sess-abc')).toEqual(['claude', '--resume', 'sess-abc'])
  })

  it('returns codex command', () => {
    expect(buildHandoffCommand('codex', 'tid-xyz')).toEqual(['codex', 'resume', 'tid-xyz'])
  })

  it('returns pi command with --session', () => {
    expect(buildHandoffCommand('pi', 'pi-sess-9')).toEqual(['pi', '--session', 'pi-sess-9'])
  })

  it('returns null for unsupported agents', () => {
    expect(buildHandoffCommand('opencode', 'oc-123')).toBeNull()
  })
})

describe('filterConversations', () => {
  const convs: Conversation[] = [
    {
      id: 'c1',
      agent: 'claude',
      cwd: '/repo/a',
      title: 'Alpha',
      status: 'idle',
      native_session_id: 's1',
      archived: false,
      created_at: 1,
      updated_at: 3,
      model: null,
      options: {},
    },
    {
      id: 'c2',
      agent: 'codex',
      cwd: '/repo/b',
      title: 'Beta',
      status: 'idle',
      native_session_id: 's2',
      archived: false,
      created_at: 2,
      updated_at: 2,
      model: null,
      options: {},
    },
    {
      id: 'c3',
      agent: 'opencode',
      cwd: '/repo/c',
      title: null,
      status: 'idle',
      native_session_id: 's3',
      archived: false,
      created_at: 3,
      updated_at: 1,
      model: null,
      options: {},
    },
  ]

  it('returns all when query is empty', () => {
    expect(filterConversations(convs, '')).toHaveLength(3)
    expect(filterConversations(convs, '  ')).toHaveLength(3)
  })

  it('filters by title', () => {
    expect(filterConversations(convs, 'Alpha').map((c) => c.id)).toEqual(['c1'])
  })

  it('filters by cwd', () => {
    expect(filterConversations(convs, '/repo/b').map((c) => c.id)).toEqual(['c2'])
  })

  it('filters by agent', () => {
    expect(filterConversations(convs, 'opencode').map((c) => c.id)).toEqual(['c3'])
  })

  it('is case-insensitive', () => {
    expect(filterConversations(convs, 'ALPHA').map((c) => c.id)).toEqual(['c1'])
  })

  it('returns empty when nothing matches', () => {
    expect(filterConversations(convs, 'zzz')).toHaveLength(0)
  })
})
