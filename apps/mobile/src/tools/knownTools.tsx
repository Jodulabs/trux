// Vendored from happy (slopus/happy, MIT), re-skinned to trux theme tokens.
// Only the 4 tools Phase B needs: Bash, Edit, Write, TodoWrite. The full
// registry lives at vendor/happy/packages/happy-app/sources/components/tools/knownTools.tsx
// and can be extended tool-by-tool as Phase B continues.
//
// Re-skin changes:
//   - stripped react-native-unistyles (no StyleSheet.create((theme) => ...))
//   - stripped @/text → identity t() shim
//   - stripped @/sync/typesMessage → local types
//   - stripped @/sync/storageTypes → local TodoItem type
//   - stripped @/utils/pathUtils → local resolvePath
//   - stripped @/utils/toolCommand (not needed for these 4 tools)
//   - icon colors use trux theme tokens

import type { Metadata, ToolCall, Message, TodoItem } from './types'
import { resolvePath } from './utils'
import { t } from './i18n'
import * as z from 'zod'
import { Ionicons, Octicons } from '@expo/vector-icons'
import React from 'react'
import { theme } from '../theme'

// Icon factory functions — color defaults to trux's text token instead of #000.
const ICON_TERMINAL = (size = 24, color: string = theme.text) => <Octicons name="terminal" size={size} color={color} />
const ICON_EDIT = (size = 24, color: string = theme.text) => <Octicons name="file-diff" size={size} color={color} />
const ICON_TODO = (size = 24, color: string = theme.text) => <Ionicons name="bulb-outline" size={size} color={color} />

const TodoItemsSchema = z.array(
  z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    id: z.string().optional(),
  }),
)

export interface KnownTool {
  title: string | ((opts: { metadata: Metadata; tool: ToolCall }) => string)
  icon: (size?: number, color?: string) => React.ReactElement
  minimal?: boolean | ((opts: { metadata: Metadata; tool: ToolCall; messages?: Message[] }) => boolean)
  isMutable?: boolean
  noStatus?: boolean
  hideDefaultError?: boolean
  input: z.ZodTypeAny
  result?: z.ZodTypeAny
  extractDescription?: (opts: { metadata: Metadata; tool: ToolCall }) => string
  extractSubtitle?: (opts: { metadata: Metadata; tool: ToolCall }) => string | null
  extractStatus?: (opts: { metadata: Metadata; tool: ToolCall }) => string | null
  hidden?: boolean
}

export const knownTools: Record<string, KnownTool> = {
  Bash: {
    title: (opts) => opts.tool.description ?? t('tools.names.terminal'),
    icon: ICON_TERMINAL,
    minimal: true,
    hideDefaultError: true,
    isMutable: true,
    input: z.object({
      command: z.string().describe('The command to execute'),
      timeout: z.number().optional().describe('Timeout in milliseconds (max 600000)'),
    }),
    result: z.object({ stderr: z.string(), stdout: z.string() }).partial().passthrough(),
    extractDescription: (opts) => {
      if (typeof opts.tool.input.command === 'string') {
        const cmd = opts.tool.input.command
        const firstWord = cmd.split(' ')[0]
        if (['cd', 'ls', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'npm', 'yarn', 'git'].includes(firstWord)) {
          return t('tools.desc.terminalCmd', { cmd: firstWord })
        }
        const truncated = cmd.length > 20 ? cmd.substring(0, 20) + '...' : cmd
        return t('tools.desc.terminalCmd', { cmd: truncated })
      }
      return t('tools.names.terminal')
    },
    extractSubtitle: (opts) =>
      typeof opts.tool.input.command === 'string' ? opts.tool.input.command : null,
  },
  Edit: {
    title: (opts) => {
      if (typeof opts.tool.input.file_path === 'string') {
        return resolvePath(opts.tool.input.file_path, opts.metadata)
      }
      return t('tools.names.editFile')
    },
    icon: ICON_EDIT,
    isMutable: true,
    input: z
      .object({
        file_path: z.string().describe('The absolute path to the file to modify'),
        old_string: z.string().describe('The text to replace'),
        new_string: z.string().describe('The text to replace it with'),
        replace_all: z.boolean().optional().default(false).describe('Replace all occurrences'),
      })
      .partial()
      .passthrough(),
  },
  Write: {
    title: (opts) => {
      if (typeof opts.tool.input.file_path === 'string') {
        return resolvePath(opts.tool.input.file_path, opts.metadata)
      }
      return t('tools.names.writeFile')
    },
    icon: ICON_EDIT,
    isMutable: true,
    input: z
      .object({
        file_path: z.string().describe('The absolute path to the file to write'),
        content: z.string().describe('The content to write to the file'),
      })
      .partial()
      .passthrough(),
  },
  TodoWrite: {
    title: t('tools.names.todoList'),
    icon: ICON_TODO,
    noStatus: true,
    minimal: (opts) => {
      if (opts.tool.input?.todos && Array.isArray(opts.tool.input.todos) && opts.tool.input.todos.length > 0) return false
      if (opts.tool.result?.newTodos && Array.isArray(opts.tool.result.newTodos) && opts.tool.result.newTodos.length > 0) return false
      return true
    },
    input: z.object({ todos: TodoItemsSchema.describe('The updated todo list') }).partial().passthrough(),
    result: z
      .object({
        oldTodos: TodoItemsSchema.describe('The old todo list'),
        newTodos: TodoItemsSchema.describe('The new todo list'),
      })
      .partial()
      .passthrough(),
    extractDescription: (opts) => {
      if (Array.isArray(opts.tool.input.todos)) {
        return t('tools.desc.todoListCount', { count: opts.tool.input.todos.length })
      }
      return t('tools.names.todoList')
    },
  },
}

export type { TodoItem }
