import '@testing-library/jest-dom/vitest'
import { configureWebClient } from '../src/ports'

// Wire the shared spine to web ports (localStorage + same-origin) before any
// test imports the spine. Mirrors main.tsx so component tests exercise the real
// port bindings the PWA uses.
configureWebClient()
