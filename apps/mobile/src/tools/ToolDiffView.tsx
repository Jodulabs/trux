// Vendored from happy (slopus/happy, MIT), re-skinned for trux.
// Source: vendor/happy/packages/happy-app/sources/components/tools/ToolDiffView.tsx
//
// Re-skin: stripped PierreDiffView (heavy deps: reanimated, skia) → simple
// local DiffView. Stripped useSetting (trux has no settings store yet) →
// defaults to showing line numbers.

import React from 'react'
import { View } from 'react-native'
import { DiffView } from './DiffView'

interface ToolDiffViewProps {
  patch?: string
  oldText?: string
  newText?: string
  fileName?: string
  style?: any
  showLineNumbers?: boolean
  showPlusMinusSymbols?: boolean
}

export const ToolDiffView = React.memo<ToolDiffViewProps>(
  ({ oldText, newText, style, showLineNumbers, showPlusMinusSymbols }) => {
    return (
      <View style={[{ flex: 1 }, style]}>
        <DiffView
          oldText={oldText ?? ''}
          newText={newText ?? ''}
          showLineNumbers={showLineNumbers ?? true}
          showPlusMinusSymbols={showPlusMinusSymbols ?? true}
        />
      </View>
    )
  },
)
