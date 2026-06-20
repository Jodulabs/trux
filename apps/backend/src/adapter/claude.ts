import { query as realQuery } from '@anthropic-ai/claude-agent-sdk'
import type { AgentCapabilities, ApprovalDecision, ImageAttachment, TurnConfig } from '@trux/protocol'
import type { AgentAdapter, AgentSession, AdapterEvent } from './types'
import { PushQueue } from './queue'

type QueryFn = typeof realQuery
type SdkUserMessage = {
  type: 'user'
  message: { role: 'user'; content: string | Array<{ type: string; [k: string]: unknown }> }
  parent_tool_use_id: null
}
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

// Split a tool_result `content` into a text output plus any base64 images.
function splitToolContent(content: unknown): { output: string; images: ImageAttachment[] } {
  if (typeof content === 'string') return { output: content, images: [] }
  if (!Array.isArray(content)) {
    return { output: content == null ? '' : JSON.stringify(content), images: [] }
  }
  const texts: string[] = []
  const images: ImageAttachment[] = []
  for (const c of content) {
    const block = c as Record<string, unknown>
    if (block.type === 'image') {
      const source = block.source as { type?: string; media_type?: string; data?: string } | undefined
      if (source?.type === 'base64' && typeof source.data === 'string') {
        images.push({ kind: 'image', media_type: source.media_type ?? 'image/png', data: source.data })
      }
    } else if (block && typeof block === 'object' && 'text' in block) {
      texts.push(String((block as { text: unknown }).text))
    } else {
      texts.push(JSON.stringify(block))
    }
  }
  return { output: texts.join(''), images }
}

// Tools whose mutations a single "Allow all edits" should cover for the session.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

class ClaudeSession implements AgentSession {
  private sessionId: string | null = null
  private readonly outbox = new PushQueue<AdapterEvent>()
  private readonly pending = new Map<string, PendingApproval>()
  private readonly q: QueryHandle
  // Session-scoped graduated-trust state, set by allow_edits / allow_command.
  private editsAllowed = false
  private readonly allowedCommands = new Set<string>()

  constructor(startQuery: (canUseTool: CanUseTool) => QueryHandle, private readonly inbox: PushQueue<SdkUserMessage>) {
    this.q = startQuery((toolName, input, options) => this.requestApproval(toolName, input, options))
    void this.consume()
  }

  // The canUseTool bridge: surface an approval_request and park the SDK's promise —
  // unless a session-scoped graduated-trust rule already covers this call, in which
  // case auto-allow without prompting (the whole point of "allow all edits" / "allow
  // this command").
  private requestApproval(
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionResult> {
    if (this.editsAllowed && EDIT_TOOLS.has(toolName)) {
      return Promise.resolve({ behavior: 'allow', updatedInput: input })
    }
    if (toolName === 'Bash' && typeof input.command === 'string' && this.allowedCommands.has(input.command)) {
      return Promise.resolve({ behavior: 'allow', updatedInput: input })
    }
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
                  const { output, images } = splitToolContent(block.content)
                  this.outbox.push({
                    type: 'tool_result',
                    tool_id: String(block.tool_use_id ?? ''),
                    status: block.is_error ? 'error' : 'ok',
                    output,
                    ...(images.length > 0 ? { images } : {}),
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

  send(text: string, attachments?: ImageAttachment[], _config?: TurnConfig): void {
    // _config is accepted for seam symmetry. Claude binds model/effort at query()
    // creation (see ClaudeAdapter.start), so a changed selection takes effect when
    // the session is next created — the SDK's own granularity, not a trux switch policy.
    if (attachments && attachments.length > 0) {
      const content: Array<{ type: string; [k: string]: unknown }> = [
        { type: 'text', text },
        ...attachments.map((a) => ({
          type: 'image',
          source: { type: 'base64', media_type: a.media_type, data: a.data },
        })),
      ]
      this.inbox.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null })
    } else {
      this.inbox.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    }
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
      return
    }
    if (decision === 'allow_always') {
      entry.resolve({ behavior: 'allow', updatedInput: entry.input, updatedPermissions: entry.suggestions })
      return
    }
    // Graduated scopes set session state so future matching calls skip the prompt.
    if (decision === 'allow_edits') this.editsAllowed = true
    if (decision === 'allow_command' && typeof entry.input.command === 'string') {
      this.allowedCommands.add(entry.input.command)
    }
    entry.resolve({ behavior: 'allow', updatedInput: entry.input })
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

  // Mirrors Claude Code's own surface. Model IDs are the bare SDK strings; effort
  // levels are the SDK's EffortLevel union. defaultModel is null and the effort
  // default is '' — trux does not pick; the backend's own default applies.
  capabilities(): AgentCapabilities {
    return {
      agent: 'claude',
      models: [
        { value: 'claude-opus-4-8', label: 'Opus 4.8' },
        { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
      ],
      defaultModel: null,
      controls: [
        {
          key: 'effort',
          label: 'Effort',
          options: [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Extra high' },
            { value: 'max', label: 'Max' },
          ],
          default: '',
        },
      ],
    }
  }

  start({ cwd, resume, config }: { cwd: string; resume?: string; config?: TurnConfig }): AgentSession {
    const inbox = new PushQueue<SdkUserMessage>()
    // Map the opaque selection onto the SDK's native knobs. Empty/absent = omit
    // (let the backend default apply) — trux imposes no model policy.
    const effort = config?.options?.effort
    const startQuery = (canUseTool: CanUseTool): QueryHandle =>
      this.queryFn({
        prompt: inbox.iterable() as never,
        options: {
          cwd,
          permissionMode: 'default',
          // SDK isolation: don't load ~/.claude or repo .claude settings, so the
          // user's global allow-list (e.g. Write(*)) can't bypass canUseTool —
          // trux is the sole permission authority. (Trade-off: no CLAUDE.md auto-load.)
          settingSources: [],
          includePartialMessages: true,
          resume,
          canUseTool: canUseTool as never,
          ...(config?.model ? { model: config.model } : {}),
          ...(effort ? { effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' } : {}),
        },
      }) as unknown as QueryHandle
    return new ClaudeSession(startQuery, inbox)
  }
}
