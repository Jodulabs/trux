// i18n shim — stubs happy's `@/text` t() to identity. trux is English-only;
// the tool-view substrate calls t('tools.names.terminal') etc. and gets the
// literal key back. This keeps the vendored views source-compatible without
// vendoring happy's full translation system.
//
// Source: vendor/happy/packages/happy-app/sources/text/ (intentionally not vendored)

export function t(key: string, params?: Record<string, string | number>): string {
  if (!params) return key
  let s = key
  for (const [k, v] of Object.entries(params)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return s
}
