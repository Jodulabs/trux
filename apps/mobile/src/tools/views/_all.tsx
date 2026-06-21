// Tool view registry — slimmed from happy's _all.tsx to the 4 tools Phase B
// implements. New tools are added here as Phase B continues.
// Source: vendor/happy/packages/happy-app/sources/components/tools/views/_all.tsx

import React from 'react'
import { EditView } from './EditView'
import { BashView } from './BashView'
import { WriteView } from './WriteView'
import { TodoView } from './TodoView'
import type { ToolCall, Metadata, Message } from '../types'

export type ToolViewProps = {
  tool: ToolCall
  metadata: Metadata
  messages: Message[]
  sessionId?: string
  permissionFooter?: React.ReactNode
}

export type ToolViewComponent = React.ComponentType<ToolViewProps>

export const toolViewRegistry: Record<string, ToolViewComponent> = {
  Edit: EditView,
  Bash: BashView,
  Write: WriteView,
  TodoWrite: TodoView,
}

export function getToolViewComponent(toolName: string): ToolViewComponent | null {
  return toolViewRegistry[toolName] || null
}

export { EditView } from './EditView'
export { BashView } from './BashView'
export { WriteView } from './WriteView'
export { TodoView } from './TodoView'
