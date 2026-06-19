// `pnpm pair` — print the pairing QR + access URLs, then exit. Show this any
// time without holding a terminal; the trux server runs separately (systemd).
import { loadEnvFiles, printAccessBanner } from './banner'
import { loadConfig } from './config'

loadEnvFiles()
printAccessBanner(loadConfig())
