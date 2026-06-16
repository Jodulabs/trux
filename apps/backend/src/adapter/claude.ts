import { query as realQuery } from '@anthropic-ai/claude-agent-sdk'
import type { ApprovalDecision } from '@trux/protocol'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'

type QueryFn = typeof realQuery
type SdkUserMessage = { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }
type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string }
type CanUseToolOptions = {
  signal: AbortSignal
  toolUseID: string
  suggestions?: unknown[]
  title?: string
  description?: string
}
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions,
) => Promise<PermissionResult>
type QueryHandle = AsyncIterable<unknown> & { interrupt(): Promise<void>; close?(): Promise<void> }

interface PendingApproval {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
  suggestions?: unknown[]
}

// Best-effort stringify of a tool_result `content` (string | content-block array | object).
function stringifyToolOutput(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c),
      )
      .join('')
  }
  return content == null ? '' : JSON.stringify(content)
}

class ClaudeSession implements AgentSession {
  private sessionId: string | null = null
  private readonly outbox = new PushQueue<AdapterEvent>()
  private readonly pending = new Map<string, PendingApproval>()
  private readonly q: QueryHandle

  constructor(startQuery: (canUseTool: CanUseTool) => QueryHandle, private readonly inbox: PushQueue<SdkUserMessage>) {
    this.q = startQuery((toolName, input, options) => this.requestApproval(toolName, input, options))
    void this.consume()
  }

  // The canUseTool bridge: surface an approval_request and park the SDK's promise.
  private requestApproval(
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const requestId = options.toolUseID
      this.pending.set(requestId, { resolve, input, suggestions: options.suggestions })
      this.outbox.push({
        type: 'approval_request',
        request_id: requestId,
        tool: toolName,
        input,
        explanation: options.title ?? options.description,
      })
      options.signal.addEventListener('abort', () => {
        if (this.pending.delete(requestId)) resolve({ behavior: 'deny', message: 'interrupted' })
      })
    })
  }

  // Drain query() for the whole session, mapping native messages onto the outbox.
  private async consume(): Promise<void> {
    try {
      for await (const raw of this.q) {
        const msg = raw as Record<string, unknown>
        if (typeof msg.session_id === 'string') this.sessionId = msg.session_id

        switch (msg.type) {
          case 'stream_event': {
            const ev = msg.stream_event as { type?: string; delta?: { type?: string; text?: string } }
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              this.outbox.push({ type: 'text_delta', text: ev.delta.text ?? '' })
            }
            break
          }
          case 'assistant': {
            const content = (msg.message as { content?: unknown[] })?.content ?? []
            for (const b of content) {
              const block = b as Record<string, unknown>
              if (block.type === 'text') {
                this.outbox.push({ type: 'text', text: String(block.text ?? '') })
              } else if (block.type === 'tool_use') {
                this.outbox.push({
                  type: 'tool_call',
                  tool_id: String(block.id ?? ''),
                  name: String(block.name ?? ''),
                  input: block.input,
                })
              }
            }
            break
          }
          case 'user': {
            const content = (msg.message as { content?: unknown })?.content
            if (Array.isArray(content)) {
              for (const b of content) {
                const block = b as Record<string, unknown>
                if (block.type === 'tool_result') {
                  this.outbox.push({
                    type: 'tool_result',
                    tool_id: String(block.tool_use_id ?? ''),
                    status: block.is_error ? 'error' : 'ok',
                    output: stringifyToolOutput(block.content),
                  })
                }
              }
            }
            break
          }
          case 'result': {
            const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined
            this.outbox.push({
              type: 'turn_complete',
              usage: { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 },
              cost: (msg.total_cost_usd as number | undefined) ?? null,
            })
            break
          }
        }
      }
    } catch (err) {
      this.outbox.push({ type: 'error', message: String(err), recoverable: true })
    } finally {
      this.outbox.end()
    }
  }

  send(text: string): void {
    this.inbox.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
  }

  events(): AsyncIterable<AdapterEvent> {
    return this.outbox.iterable()
  }

  respondApproval(requestId: string, decision: ApprovalDecision, note?: string | null): void {
    const entry = this.pending.get(requestId)
    if (!entry) return
    this.pending.delete(requestId)
    if (decision === 'deny') {
      entry.resolve({ behavior: 'deny', message: note ?? 'Denied by user' })
    } else if (decision === 'allow_always') {
      entry.resolve({ behavior: 'allow', updatedInput: entry.input, updatedPermissions: entry.suggestions })
    } else {
      entry.resolve({ behavior: 'allow', updatedInput: entry.input })
    }
  }

  async interrupt(): Promise<void> {
    await this.q.interrupt()
  }
  async close(): Promise<void> {
    await this.q.close?.()
    this.outbox.end()
  }
  nativeSessionId(): string | null {
    return this.sessionId
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly name = 'claude' as const
  constructor(private readonly queryFn: QueryFn = realQuery) {}

  start({ cwd, resume }: { cwd: string; resume?: string }): AgentSession {
    const inbox = new PushQueue<SdkUserMessage>()
    const startQuery = (canUseTool: CanUseTool): QueryHandle =>
      this.queryFn({
        prompt: inbox.iterable() as never,
        options: {
          cwd,
          permissionMode: 'default',
          includePartialMessages: true,
          resume,
          canUseTool: canUseTool as never,
        },
      }) as unknown as QueryHandle
    return new ClaudeSession(startQuery, inbox)
  }
}
