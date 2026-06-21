import { useCallback, useEffect, useRef, useState } from 'react'
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import { theme } from '../theme'

interface Props {
  // Called once per valid scan; the scanner dedupes so this fires at most once
  // until onReset() re-arms it (e.g. when the parsed payload is rejected and the
  // user should try again).
  onScanned: (data: string) => void
  // When true, suppresses the scan callback (e.g. while a parsed payload is
  // being validated). The camera stays live so the user can re-scan.
  paused?: boolean
}

// Live QR scanner over the back camera. Restricts barcode detection to QR and
// fires onScanned with the raw payload string for the caller to parse. A
// copper-tinted target frame guides alignment; the frame pulses via a simple
// border, no reanimation yet (deferred to A4).
export function QrScanner({ onScanned, paused }: Props): React.ReactElement {
  const [permission, requestPermission] = useCameraPermissions()
  const [active, setActive] = useState(false)
  const lastScan = useRef<{ data: string; at: number } | null>(null)

  useEffect(() => {
    void requestPermission()
  }, [requestPermission])

  const handleScan = useCallback(
    (result: { type: string; data: string }): void => {
      if (paused) return
      const now = Date.now()
      // expo-camera fires onBarcodeScanned on every frame the QR is in view —
      // dedupe within a 2.5s window so the callback isn't hammered, and so a
      // rejected payload can be re-scanned after the user adjusts.
      if (lastScan.current && lastScan.current.data === result.data && now - lastScan.current.at < 2500) {
        return
      }
      lastScan.current = { data: result.data, at: now }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      onScanned(result.data)
    },
    [onScanned, paused],
  )

  if (!permission) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={theme.accent} />
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>Camera access denied.</Text>
        <Text style={styles.stateHint}>Tap below to grant it, or paste the URL manually.</Text>
        <Text style={styles.grantBtn} onPress={() => void requestPermission()}>
          Grant camera access
        </Text>
      </View>
    )
  }

  return (
    <View
      style={styles.cameraWrap}
      onLayout={(e) => setActive(e.nativeEvent.layout.width > 0)}
    >
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        active={active}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleScan}
      />
      <View style={styles.frameOverlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.frameHint}>Point at the trux pair QR</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  cameraWrap: {
    flex: 1,
    borderRadius: theme.radius,
    overflow: 'hidden',
    backgroundColor: theme.surface1,
    minHeight: 280,
  },
  state: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20 },
  stateText: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, textAlign: 'center' },
  stateHint: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans, textAlign: 'center' },
  grantBtn: {
    color: theme.accent,
    fontFamily: `${theme.fontSans}-600`,
    fontSize: 15,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radiusSm,
    overflow: 'hidden',
  },
  frameOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 220,
    height: 220,
    borderWidth: 2,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    backgroundColor: 'transparent',
    opacity: 0.9,
  },
  frameHint: {
    color: theme.text,
    fontSize: 13,
    fontFamily: theme.fontSans,
    marginTop: 16,
    textShadowColor: theme.ink,
    textShadowRadius: 4,
  },
})
