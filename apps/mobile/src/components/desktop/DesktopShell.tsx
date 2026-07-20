import { View, StyleSheet } from 'react-native'
import { Slot } from 'expo-router'
import { Sidebar } from './Sidebar'
import { theme } from '../../theme'

export function DesktopShell(): React.ReactElement {
  return (
    <View style={styles.shell}>
      <Sidebar />
      <View style={styles.main}>
        <Slot />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: theme.ink },
  main: { flex: 1, minWidth: 0 },
})
