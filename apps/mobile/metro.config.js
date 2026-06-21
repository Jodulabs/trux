// Metro config for the trux monorepo: let Metro follow pnpm workspace symlinks
// to @trux/client and @trux/protocol by watching the repo root and pointing
// resolver at the shared node_modules.
// Use `expo/metro-config` (re-export) rather than `@expo/metro-config`
// directly: the latter is a transitive dep not symlinked into the app under
// pnpm, so a direct require can't resolve it; `expo` is a direct dependency.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [repoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
]
// pnpm symlinks workspace packages; Metro must follow them.
config.resolver.unstable_enableSymlinks = true
config.resolver.unstable_enablePackageExports = true

// Keep co-located test files out of the app bundle. Expo Router's require.context
// globs the entire app/ tree and would otherwise pull `app/**/*.test.tsx` into
// the bundle, dragging in @testing-library/react-native (which imports Node's
// `console`/`util`, absent in the RN runtime). Jest uses its own config, so it
// still discovers and runs these tests.
const testFileBlocklist = [/.*\.test\.[jt]sx?$/, /.*\.spec\.[jt]sx?$/]
const existingBlockList = config.resolver.blockList
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList
      ? [existingBlockList]
      : []),
  ...testFileBlocklist,
]

module.exports = config
