import { pairTools, toToolCall, adaptTools } from './toolView'
import type { ToolCallEvent, ToolResultEvent, ApprovalRequestEvent } from '@trux/protocol'

const call = (tool_id: string, name: string, input: unknown): ToolCallEvent => ({
  type: 'tool_call',
  turn_id: 't1',
  tool_id,
  name,
  input,
})

const result = (tool_id: string, status: 'ok' | 'error', output: string): ToolResultEvent => ({
  type: 'tool_result',
  turn_id: 't1',
  tool_id,
  status,
  output,
})

const approval = (request_id: string, tool: string, input: unknown): ApprovalRequestEvent => ({
  type: 'approval_request',
  turn_id: 't1',
  request_id,
  tool,
  input,
})

describe('toolView adapter', () => {
  describe('pairTools', () => {
    it('pairs a tool_call with its matching tool_result by tool_id', () => {
      const items = [call('id1', 'Bash', { command: 'ls' }), result('id1', 'ok', 'file.txt')]
      const paired = pairTools(items, {})
      expect(paired).toHaveLength(1)
      expect(paired[0].call.name).toBe('Bash')
      expect(paired[0].result?.status).toBe('ok')
    })

    it('leaves a tool_call without a result as running', () => {
      const items = [call('id1', 'Bash', { command: 'ls' })]
      const paired = pairTools(items, {})
      expect(paired).toHaveLength(1)
      expect(paired[0].result).toBeUndefined()
    })

    it('matches an approval_request to the last call with the same tool name', () => {
      const items = [
        call('id1', 'Read', { file_path: '/a.ts' }),
        call('id2', 'Bash', { command: 'rm -rf /' }),
        approval('req1', 'Bash', { command: 'rm -rf /' }),
      ]
      const paired = pairTools(items, {})
      expect(paired).toHaveLength(2)
      expect(paired[1].approval?.request_id).toBe('req1')
    })

    it('attaches the approval decision from approvalDecisions', () => {
      const items = [call('id1', 'Bash', { command: 'ls' }), approval('req1', 'Bash', { command: 'ls' })]
      const paired = pairTools(items, { req1: 'allow' })
      expect(paired[0].decision).toBe('allow')
    })
  })

  describe('toToolCall', () => {
    it('maps a running tool_call to state=running', () => {
      const step = { call: call('id1', 'Bash', { command: 'ls' }) }
      const tc = toToolCall(step)
      expect(tc.name).toBe('Bash')
      expect(tc.state).toBe('running')
      expect(tc.input).toEqual({ command: 'ls' })
      expect(tc.result).toBeUndefined()
    })

    it('maps a completed tool_call+result to state=completed with parsed result', () => {
      const step = { call: call('id1', 'Bash', { command: 'ls' }), result: result('id1', 'ok', '{"stdout":"file.txt","stderr":""}') }
      const tc = toToolCall(step)
      expect(tc.state).toBe('completed')
      expect(tc.result).toEqual({ stdout: 'file.txt', stderr: '' })
    })

    it('maps an errored tool_result to state=error', () => {
      const step = { call: call('id1', 'Bash', { command: 'ls' }), result: result('id1', 'error', 'command not found') }
      const tc = toToolCall(step)
      expect(tc.state).toBe('error')
      expect(tc.result).toBe('command not found')
    })

    it('maps a pending approval to permission.status=pending', () => {
      const step = {
        call: call('id1', 'Bash', { command: 'ls' }),
        approval: approval('req1', 'Bash', { command: 'ls' }),
      }
      const tc = toToolCall(step)
      expect(tc.permission).toEqual({ id: 'req1', status: 'pending' })
    })

    it('maps a denied approval to permission.status=denied', () => {
      const step = {
        call: call('id1', 'Bash', { command: 'ls' }),
        approval: approval('req1', 'Bash', { command: 'ls' }),
        decision: 'deny' as const,
      }
      const tc = toToolCall(step)
      expect(tc.permission?.status).toBe('denied')
    })

    it('maps an approved approval to permission.status=approved', () => {
      const step = {
        call: call('id1', 'Bash', { command: 'ls' }),
        approval: approval('req1', 'Bash', { command: 'ls' }),
        decision: 'allow' as const,
      }
      const tc = toToolCall(step)
      expect(tc.permission?.status).toBe('approved')
    })
  })

  describe('adaptTools', () => {
    it('returns ToolCall[] ready for the view registry', () => {
      const items = [
        call('id1', 'Bash', { command: 'ls' }),
        result('id1', 'ok', '{"stdout":"a\nb"}'),
        call('id2', 'Edit', { file_path: '/x.ts', old_string: 'a', new_string: 'b' }),
      ]
      const tools = adaptTools(items, {})
      expect(tools).toHaveLength(2)
      expect(tools[0].name).toBe('Bash')
      expect(tools[0].state).toBe('completed')
      expect(tools[1].name).toBe('Edit')
      expect(tools[1].state).toBe('running')
    })

    it('unknown tools fall back gracefully (no crash, name preserved)', () => {
      const items = [call('id1', 'SomeUnknownTool', { foo: 'bar' })]
      const tools = adaptTools(items, {})
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('SomeUnknownTool')
      expect(tools[0].state).toBe('running')
    })
  })
})
