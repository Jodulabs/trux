import { View, StyleSheet } from 'react-native'
import { previewUrl } from '@trux/client/preview'

interface Props {
  port: number
}

export function InlinePreview({ port }: Props): React.ReactElement {
  return (
    <View style={styles.shell}>
      <iframe
        src={previewUrl(port)}
        title={`Preview ${port}`}
        style={{ border: 'none', width: '100%', height: '100%' }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
})
