// Thin alias kept for `pnpm pair` / older docs — prefer `trux pair` / `tsx src/cli.ts pair`.
import { runCli } from './cli'

runCli(['pair', ...process.argv.slice(2)]).then((code) => process.exit(code))
