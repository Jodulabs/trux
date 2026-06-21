// B1: The toolView adapter — the central seam between trux's protocol events
// and happy's tool-view view-model. One mapper, one place; every per-tool card
// downstream is then data-driven.
//
// trux's transcript is a flat list of ToolCallEvent | ToolResultEvent |
// ApprovalRequestEvent items (linked by tool_id). happy's tool-view registry
// dispatches on a ToolCall view-model: { name, state, input, createdAt,
// startedAt, completedAt, description, result, permission }.
//
// This adapter:
//   1. Pairs a ToolCallEvent with its matching ToolResultEvent (by tool_id)
//   2. Maps the pair to happy's ToolCall view-model
//   3. Folds in the ApprovalRequestEvent (if any) as the permission field
//   4. Unknown tools fall back gracefully — the ToolView renders a default
//      JSON input/output card when no specific view is registered.

import type {
  ApprovalDecision,
  ApprovalRequestEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '@trux/protocol'
import type { ToolCall, ToolPermission } from './tools/types'

// A paired tool step: the call event plus its optional result and approval.
export interface PairedTool {
  call: ToolCallEvent
  result?: ToolResultEvent
  approval?: ApprovalRequestEvent
  decision?: ApprovalDecision
}

// Pair each tool_call with its tool_result and approval_request (all linked by
// tool_id). This is the same pairing logic the PWA's ActivityGroup uses, now
// extended to also fold in approval_request events.
export function pairTools(
  items: Array<ToolCallEvent | ToolResultEvent | ApprovalRequestEvent>,
  approvalDecisions: Record<string, ApprovalDecision>,
): PairedTool[] {
  const steps: PairedTool[] = []
  const byToolId = new Map<string, PairedTool>()
  for (const item of items) {
    if (item.type === 'tool_call') {
      const step: PairedTool = { call: item }
      steps.push(step)
      byToolId.set(item.tool_id, step)
    } else if (item.type === 'tool_result') {
      const existing = byToolId.get(item.tool_id)
      if (existing) existing.result = item
      // A result without a call is orphaned; skip it (shouldn't happen in
      // practice — the server always sends tool_call before tool_result).
    } else if (item.type === 'approval_request') {
      // approval_request has request_id, not tool_id. We match by tool name +
      // input proximity — the approval always immediately follows the tool_call
      // it's about. In practice the adapter is called with the transcript slice
      // up to and including the approval, so we match the last unmatched call
      // with the same tool name.
      const tool = item.tool
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].call.name === tool && !steps[i].approval) {
          steps[i].approval = item
          steps[i].decision = approvalDecisions[item.request_id]
          break
        }
      }
    }
  }
  return steps
}

// Map a paired tool step to happy's ToolCall view-model. This is the single
// place trux protocol data is transformed into the shape knownTools dispatches
// on.
export function toToolCall(step: PairedTool): ToolCall {
  const { call, result, approval, decision } = step
  let state: ToolCall['state'] = 'running'
  if (result) {
    state = result.status === 'ok' ? 'completed' : 'error'
  }

  let permission: ToolPermission | undefined
  if (approval) {
    let permStatus: ToolPermission['status'] = 'pending'
    if (decision === 'deny') permStatus = 'denied'
    else if (decision) permStatus = 'approved'
    permission = {
      id: approval.request_id,
      status: permStatus,
    }
  }

  // Parse the result output for the view. Bash results may be JSON with
  // stdout/stderr; other tools may have string or JSON output. The per-tool
  // views parse this via their zod result schema.
  let resultData: any
  if (result) {
    try {
      resultData = JSON.parse(result.output)
    } catch {
      resultData = result.output
    }
  }

  return {
    name: call.name,
    state,
    input: call.input,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    description: null,
    result: resultData,
    permission,
  }
}

// Convenience: pair + map in one call. Returns ToolCall[] ready for the
// ToolView registry to dispatch on.
export function adaptTools(
  items: Array<ToolCallEvent | ToolResultEvent | ApprovalRequestEvent>,
  approvalDecisions: Record<string, ApprovalDecision>,
): ToolCall[] {
  return pairTools(items, approvalDecisions).map(toToolCall)
}
