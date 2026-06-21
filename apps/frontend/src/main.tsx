import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import { App } from './App'
import { configureWebClient } from './ports'
import { consumePairingToken } from './pairing'

// Wire the shared spine to web ports (localStorage + same-origin) before any
// spine code runs — including the pairing token write below.
configureWebClient()
// A QR-paired phone arrives with the token in the URL fragment — store it before first render
// so the app boots authenticated (skips the TokenGate).
consumePairingToken()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
