import { config as loadDotenv } from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import qrcode from 'qrcode-terminal'
import type { Config } from './config'

// Load env: repo-local .env first (dev), then ~/.trux/.env (the deployed box).
// dotenv never overrides an already-set var, so the first load wins per key.
export function loadEnvFiles(): void {
  loadDotenv()
  const userEnv = join(homedir(), '.trux', '.env')
  if (existsSync(userEnv)) loadDotenv({ path: userEnv })
}

// Compact banner for `pnpm start` — how to reach trux, no QR (the QR floods the
// terminal on every start; `pnpm pair` is the QR path). One glanceable block.
export function printStartBanner(config: Config): void {
  console.log(`\n   local:  http://localhost:${config.port}/`)
  if (config.tailscaleHost) {
    console.log(`   phone:  https://${config.tailscaleHost}/`)
    if (config.secret) console.log('   pair:   run `pnpm pair` to show the QR for one-scan phone setup')
    else console.log('   (auth disabled)')
  }
  console.log('')
}

// Full pairing banner for `pnpm pair`. With a tailnet host + secret, show a QR
// that pairs a phone in one scan (URL + token in the fragment — see frontend pairing).
export function printAccessBanner(config: Config): void {
  if (config.tailscaleHost) {
    const base = `https://${config.tailscaleHost}/`
    if (config.secret) {
      console.log('\n📱 Pair your phone — scan this (phone must be on the tailnet):\n')
      qrcode.generate(`${base}#token=${encodeURIComponent(config.secret)}`, { small: true })
      console.log(`\n   …or open ${base} and paste your token`)
    } else {
      console.log(`\n📱 Phone: open ${base} (auth disabled)`)
    }
  }
  console.log(`\n   local: http://localhost:${config.port}/\n`)
}
