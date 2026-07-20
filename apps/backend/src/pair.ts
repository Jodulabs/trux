// `pnpm pair` — print the pairing QR + access URLs, then exit. Show this any
// time without holding a terminal; the trux server runs separately (systemd).
import { loadEnvFiles, printAccessBanner, printAccessLink } from './banner'
import { loadConfig } from './config'

loadEnvFiles()
const config = loadConfig()
if (process.argv.includes('--link')) {
  printAccessLink(config)
} else {
  printAccessBanner(config)
}
