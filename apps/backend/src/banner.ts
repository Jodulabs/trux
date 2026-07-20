import { config as loadDotenv } from 'dotenv'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Config } from './config'
import { writePairCode, pairUrl } from './pair-code'
import { renderBrailleQr } from './qr-braille'

// Load env: repo-local .env first (dev), then ~/.trux/.env (the deployed box).
// dotenv never overrides an already-set var, so the first load wins per key.
export function loadEnvFiles(): void {
  loadDotenv({ quiet: true })
  const userEnv = join(homedir(), '.trux', '.env')
  if (existsSync(userEnv)) loadDotenv({ path: userEnv, quiet: true })
}

export function publicHostname(config: Config): string | null {
  return config.publicHost ?? config.tailscaleHost ?? null
}

export function buildPairUrl(config: Config, home: string = homedir()): string | null {
  const host = publicHostname(config)
  if (!host || !config.secret) return null
  const { code } = writePairCode({ home })
  return pairUrl(host, code)
}

export function buildOpenUrl(config: Config): string {
  const base = `http://localhost:${config.port}/`
  if (config.secret) return `${base}#token=${encodeURIComponent(config.secret)}`
  return base
}

export function buildAccessUrl(config: Config): string {
  const host = publicHostname(config)
  if (host) return `https://${host}/`
  return `http://localhost:${config.port}/`
}

// Compact banner for `pnpm start` — how to reach trux, no QR.
export function printStartBanner(config: Config): void {
  const host = publicHostname(config)
  console.log(`\n   local:  http://localhost:${config.port}/`)
  if (host) {
    console.log(`   phone:  https://${host}/`)
    if (config.secret) console.log('   pair:   run `trux pair` to show the QR for one-scan phone setup')
    else console.log('   (auth disabled)')
  }
  if (config.secret) console.log('   open:   run `trux open` to launch on this box already signed in')
  console.log('')
}

// Full pairing banner for `trux pair`. Short /p/<code> URL + braille QR.
export function printAccessBanner(config: Config, home: string = homedir()): void {
  const url = buildPairUrl(config, home)
  if (url) {
    console.log('\nPair your phone — scan this:\n')
    console.log(renderBrailleQr(url))
    console.log(`\n   ${url}`)
    console.log('   …or open the URL above in a browser on the tailnet')
  } else {
    const host = publicHostname(config)
    if (host) console.log(`\nPhone: open https://${host}/ (auth disabled or no secret)`)
    else console.log('\nNo public host configured (set TRUX_PUBLIC_HOST or TRUX_TAILSCALE_HOST)')
  }
  console.log(`\n   local: http://localhost:${config.port}/\n`)
}

// Print just the pairing URL (for `trux pair --link`).
export function printAccessLink(config: Config, home: string = homedir()): void {
  const url = buildPairUrl(config, home)
  if (url) {
    console.log(url)
    return
  }
  const host = publicHostname(config)
  if (host) console.log(`https://${host}/ (auth disabled)`)
  else console.log(`http://localhost:${config.port}/`)
}
