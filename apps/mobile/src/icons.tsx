import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { theme } from './theme'

export type IconName = keyof typeof Ionicons.glyphMap

interface IconButtonProps {
  name: IconName
  accessibilityLabel: string
  onPress: () => void
  size?: number
  color?: string
  style?: StyleProp<ViewStyle>
  hitSlop?: number
  disabled?: boolean
}

/** 44×44 icon control — one vocabulary for chrome across mobile + web. */
export function IconButton({
  name,
  accessibilityLabel,
  onPress,
  size = 20,
  color = theme.textDim,
  style,
  hitSlop = 4,
  disabled,
}: IconButtonProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      <Ionicons name={name} size={size} color={color} accessibilityElementsHidden />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radiusSm,
  },
  pressed: { backgroundColor: theme.surface2 },
  disabled: { opacity: 0.4 },
})
