import { query as realQuery } from '@anthropic-ai/claude-agent-sdk'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'

// The SDK's exact message/content types live behind skipLibCheck; we narrow the
// few fields we read. `query` is injected so tests can drive a fake generator.
type QueryFn = typeof realQuery
type SdkUserMessage = { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }
type QueryHandle = AsyncIterable<unknown> & { interrupt(): Promise<void>; close?(): Promise<void> }

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
  constructor(
    private readonly q: QueryHandle,
    private readonly inbox: PushQueue<SdkUserMessage>,
  ) {}

  send(text: string): void {
    this.inbox.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
  }

  async *events(): AsyncIterable<AdapterEvent> {
    for await (const raw of this.q) {
      const msg = raw as Record<string, unknown>
      if (typeof msg.session_id === 'string') this.sessionId = msg.session_id

      switch (msg.type) {
        case 'stream_event': {
          const ev = msg.stream_event as { type?: string; delta?: { type?: string; text?: string } }
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            yield { type: 'text_delta', text: ev.delta.text ?? '' }
          }
          break
        }
        case 'assistant': {
          const content = (msg.message as { content?: unknown[] })?.content ?? []
          for (const b of content) {
            const block = b as Record<string, unknown>
            if (block.type === 'text') {
              yield { type: 'text', text: String(block.text ?? '') }
            } else if (block.type === 'tool_use') {
              yield {
                type: 'tool_call',
                tool_id: String(block.id ?? ''),
                name: String(block.name ?? ''),
                input: block.input,
              }
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
                yield {
                  type: 'tool_result',
                  tool_id: String(block.tool_use_id ?? ''),
                  status: block.is_error ? 'error' : 'ok',
                  output: stringifyToolOutput(block.content),
                }
              }
            }
          }
          break
        }
        case 'result': {
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined
          yield {
            type: 'turn_complete',
            usage: { input: usage?.input_tokens ?? 0, output: usage?.output_tokens ?? 0 },
            cost: (msg.total_cost_usd as number | undefined) ?? null,
          }
          break
        }
      }
    }
  }

  async interrupt(): Promise<void> {
    await this.q.interrupt()
  }
  async close(): Promise<void> {
    await this.q.close?.()
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
    const q = this.queryFn({
      // The SDK accepts an AsyncIterable of user messages for streaming-input mode.
      prompt: inbox.iterable() as never,
      options: { cwd, permissionMode: 'bypassPermissions', includePartialMessages: true, resume },
    }) as unknown as QueryHandle
    return new ClaudeSession(q, inbox)
  }
}
