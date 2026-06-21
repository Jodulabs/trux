import { useEffect, useState } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import {
  useFonts,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from '@expo-google-fonts/ibm-plex-sans'
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
} from '@expo-google-fonts/ibm-plex-mono'

import { theme } from '../src/theme'
import { configureNativeClient } from '../src/ports'

export { ErrorBoundary } from 'expo-router'

// Root layout: load IBM Plex fonts + hydrate the native Storage port from
// secure-store/AsyncStorage, then mount the router. The spine is configured
// before any screen renders so @trux/client reads a populated sync cache.
export default function RootLayout(): React.ReactElement {
  const [portsReady, setPortsReady] = useState(false)
  const [fontsLoaded] = useFonts({
    [theme.fontSans]: IBMPlexSans_400Regular,
    [`${theme.fontSans}-500`]: IBMPlexSans_500Medium,
    [`${theme.fontSans}-600`]: IBMPlexSans_600SemiBold,
    [theme.fontMono]: IBMPlexMono_400Regular,
    [`${theme.fontMono}-500`]: IBMPlexMono_500Medium,
  })

  useEffect(() => {
    void configureNativeClient().finally(() => setPortsReady(true))
  }, [])

  if (!fontsLoaded || !portsReady) {
    return (
      <View style={styles.splash}>
        <StatusBar style="light" />
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    )
  }

  return (
    <KeyboardProvider>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.ink },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(app)" />
          <Stack.Screen name="pair" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </KeyboardProvider>
  )
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
