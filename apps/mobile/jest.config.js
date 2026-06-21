// Jest config for the Expo mobile app under a pnpm workspace. The
// transformIgnorePatterns must be pnpm-aware: real package files live under
// `node_modules/.pnpm/<pkg>+<deps>/node_modules/<pkg>/…`. A naive
// `node_modules/(?!<rn-pkg>)` lookahead matches the first `node_modules/`
// (followed by `.pnpm/`, never an RN pkg) and wrongly ignores every RN file.
//
// Two alternatives avoid that:
//  1. `node_modules/.pnpm/<dir>/node_modules/` NOT followed by an RN pkg →
//     ignore non-RN pnpm packages (RN ones fall through → transformed).
//  2. `node_modules/` NOT followed by an RN pkg AND NOT `.pnpm` → ignore
//     non-RN direct packages; the `.pnpm` case is handled by (1).
const RN_PACKAGES = [
  '(jest-)?react-native',
  '@react-native(-community)?',
  'expo(nent)?',
  '@expo(nent)?',
  '@expo-google-fonts',
  'react-navigation',
  '@react-navigation',
  'react-native-svg',
  'react-native-reanimated',
  'react-native-gesture-handler',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-keyboard-controller',
  '@react-native-async-storage',
  'zustand',
].join('|')

module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    `node_modules/(?:\\.pnpm/[^/]+/node_modules/(?!${RN_PACKAGES})|(?!${RN_PACKAGES}|\\.pnpm))`,
  ],
  testPathIgnorePatterns: ['/node_modules/', '/android/', '/ios/', '/.expo/'],
}
