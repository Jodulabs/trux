// Vendored from happy (slopus/happy, MIT), re-skinned to trux theme tokens.
// Source: vendor/happy/packages/happy-app/sources/components/tools/views/TodoView.tsx
//
// Re-skin: hardcoded #000/#34C759/#007AFF/#666 → trux text/ok/accent/textDim.

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { ToolViewProps } from './_all'
import { knownTools } from '../knownTools'
import { ToolSectionView } from '../ToolSectionView'
import { theme } from '../../theme'

export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority?: 'high' | 'medium' | 'low'
  id?: string
}

export const TodoView = React.memo<ToolViewProps>(({ tool }) => {
  let todosList: Todo[] = []

  const parsedArguments = knownTools.TodoWrite.input.safeParse(tool.input)
  if (parsedArguments.success && (parsedArguments.data as any).todos) {
    todosList = (parsedArguments.data as any).todos
  }

  const parsed = knownTools.TodoWrite.result?.safeParse(tool.result)
  if (parsed?.success && (parsed.data as any).newTodos) {
    todosList = (parsed.data as any).newTodos
  }

  if (todosList.length > 0) {
    return (
      <ToolSectionView>
        <View style={styles.container}>
          {todosList.map((todo, index) => {
            const isCompleted = todo.status === 'completed'
            const isInProgress = todo.status === 'in_progress'
            let textStyle: any = styles.todoText
            let icon = '☐'
            if (isCompleted) {
              textStyle = [styles.todoText, styles.completedText]
              icon = '☑'
            } else if (isInProgress) {
              textStyle = [styles.todoText, styles.inProgressText]
              icon = '☐'
            }
            return (
              <View key={todo.id || `todo-${index}`} style={styles.todoItem}>
                <Text style={textStyle}>
                  {icon} {todo.content}
                </Text>
              </View>
            )
          })}
        </View>
      </ToolSectionView>
    )
  }
  return null
})

const styles = StyleSheet.create({
  container: { gap: 4 },
  todoItem: { paddingVertical: 2 },
  todoText: { fontSize: 14, color: theme.text, flex: 1 },
  completedText: { color: theme.ok, textDecorationLine: 'line-through' },
  inProgressText: { color: theme.accent },
  pendingText: { color: theme.textDim },
})
