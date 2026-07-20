import { spawnSync } from 'node:child_process'
import {
  loadEnvFiles,
  printAccessBanner,
  printAccessLink,
  buildOpenUrl,
  buildAccessUrl,
} from './banner'
import { loadConfig, type Config } from './config'
import { runResume } from './resume'

export type OpenDeps = {
  hasSystemd: () => boolean
  isServiceActive: () => boolean
  startService: () => void
  waitForHealth: (port: number, timeoutMs: number) => Promise<boolean>
  openBrowser: (url: string) => boolean
  log: (msg: string) => void
  error: (msg: string) => void
}

export function defaultOpenDeps(): OpenDeps {
  return {
    hasSystemd: () => spawnSync('systemctl', ['--user'], { stdio: 'ignore' }).error == null,
    isServiceActive: () =>
      spawnSync('systemctl', ['--user', 'is-active', '--quiet', 'trux.service']).status === 0,
    startService: () => {
      const r = spawnSync('systemctl', ['--user', 'start', 'trux.service'], { stdio: 'inherit' })
      if (r.status !== 0) throw new Error('failed to start trux.service')
    },
    waitForHealth: (port, timeoutMs) => waitForHealth(port, timeoutMs),
    openBrowser: (url) => {
      if (spawnSync('xdg-open', [url], { stdio: 'ignore' }).status === 0) return true
      return false
    },
    log: (msg) => console.log(msg),
    error: (msg) => console.error(msg),
  }
}

export async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      })
      if (res.ok) return true
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

export async function runOpen(config: Config, deps: OpenDeps = defaultOpenDeps()): Promise<number> {
  if (deps.hasSystemd() && !deps.isServiceActive()) {
    try {
      deps.log('trux: starting service…')
      deps.startService()
    } catch (err) {
      deps.error(`trux: ${(err as Error).message}`)
      return 1
    }
  }

  const ok = await deps.waitForHealth(config.port, 10_000)
  if (!ok) {
    deps.error(`trux: backend not healthy on port ${config.port} — is it running?`)
    return 1
  }

  const url = buildOpenUrl(config)
  if (deps.openBrowser(url)) deps.log(`trux: opening ${url}`)
  else deps.log(url)
  return 0
}

function printCliHelp(): void {
  console.log(`usage: trux <command>

Access:
  open              launch the web UI on this box (signed in)
  pair [--link]     show phone-pairing QR + link (or link only)
  url               print the access URL
  token             print the auth token
  resume [query]    hand a conversation to the native CLI
`)
}

export async function runCli(argv: string[]): Promise<number> {
  loadEnvFiles()
  const config = loadConfig()
  const [cmd, ...rest] = argv

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printCliHelp()
      return 0
    case 'pair':
      if (rest.includes('--link')) printAccessLink(config)
      else printAccessBanner(config)
      return 0
    case 'url':
      console.log(buildAccessUrl(config))
      return 0
    case 'token':
      if (!config.secret) {
        console.error('trux: no TRUX_SECRET configured')
        return 1
      }
      console.log(config.secret)
      return 0
    case 'open':
      return runOpen(config)
    case 'resume':
      return runResume(rest)
    default:
      printCliHelp()
      return 1
  }
}

const isEntry =
  process.argv[1] != null &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1]) ||
    process.argv[1].endsWith('/cli.ts') ||
    process.argv[1].endsWith('/cli.js'))

if (isEntry) {
  runCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
