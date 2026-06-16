import type { ApprovalDecision, ClientMessage } from './events'

const DECISIONS: readonly ApprovalDecision[] = ['allow', 'deny', 'allow_always']

// Validate and narrow an untrusted inbound frame to a ClientMessage.
// Returns null on anything malformed — the WS boundary must never trust raw input.
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>

  switch (d.type) {
    case 'auth':
      return typeof d.token === 'string' ? { type: 'auth', token: d.token } : null
    case 'user_message':
      return typeof d.text === 'string' ? { type: 'user_message', text: d.text } : null
    case 'approval_response':
      if (typeof d.request_id !== 'string') return null
      if (!DECISIONS.includes(d.decision as ApprovalDecision)) return null
      return {
        type: 'approval_response',
        request_id: d.request_id,
        decision: d.decision as ApprovalDecision,
        // Absent or non-string note normalizes to null — always present after parsing.
        note: typeof d.note === 'string' ? d.note : null,
      }
    case 'interrupt':
      return { type: 'interrupt' }
    default:
      return null
  }
}
