// Generates apps/mobile/src/components/terminalHtml.generated.ts — a fully
// self-contained xterm.js HTML document (CSS + UMD JS inlined, NO CDN) that
// runs inside the TerminalPane webview (native) / iframe (web) and speaks the
// trux postMessage bridge protocol. Run via `pnpm --filter @trux/mobile gen:terminal-html`.
//
// Why generated, not hand-committed: xterm's UMD bundle is ~290KB; reading it
// from the installed package keeps it versioned with the dependency and offline
// (a trux box may have no internet). The output is committed source — it's
// regeneratable but checked in so builds don't depend on this script running.
//
// pnpm symlink reality: the @xterm packages live under node_modules/.pnpm/...;
// createRequire(...).resolve() from this package's root resolves the real paths
// through pnpm's symlinks, so we never hardcode a .pnpm directory name.

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const require = createRequire(resolve(pkgRoot, 'package.json'))

const xtermJsPath = require.resolve('@xterm/xterm/lib/xterm.js')
const xtermCssPath = require.resolve('@xterm/xterm/css/xterm.css')
const fitAddonPath = require.resolve('@xterm/addon-fit/lib/addon-fit.js')

const xtermJs = readFileSync(xtermJsPath, 'utf8')
const xtermCss = readFileSync(xtermCssPath, 'utf8')
const fitAddon = readFileSync(fitAddonPath, 'utf8')

// The bridge script glues xterm to the host. It supports BOTH transports:
//   - native: window.ReactNativeWebView.postMessage(json) → host onMessage
//   - web:    window.parent.postMessage(obj, '*')         → host message listener
// Host→page is always window.__truxRecv(msg).
const bridgeJs = `
(function () {
  var isRN = !!(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function');
  function send(msg) {
    if (isRN) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
  }

  var FitAddonCtor = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
  var term = new window.Terminal({
    fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
    fontSize: 13,
    convertEol: true,
    cursorBlink: true,
    theme: { background: '#0c0d10', foreground: '#e7e4dd', cursor: '#e8843d' }
  });
  var fit = new FitAddonCtor();
  term.loadAddon(fit);
  term.open(document.getElementById('term'));

  function doFit() {
    try { fit.fit(); } catch (e) {}
    send({ type: 'resize', cols: term.cols, rows: term.rows });
  }

  term.onData(function (data) { send({ type: 'input', data: data }); });

  // Host → page.
  window.__truxRecv = function (msg) {
    if (!msg) return;
    if (msg.type === 'output' && typeof msg.data === 'string') term.write(msg.data);
    else if (msg.type === 'exit') term.write('\\r\\n[process exited' + (msg.code != null ? ' (' + msg.code + ')' : '') + ']\\r\\n');
  };

  // Web transport: host posts into the iframe window.
  window.addEventListener('message', function (ev) {
    if (ev.source === window) return;
    window.__truxRecv(ev.data);
  });

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { doFit(); });
    ro.observe(document.getElementById('term'));
  }
  window.addEventListener('resize', doFit);

  // Fit once layout settles, then announce readiness so the host opens the
  // channel only after the page can receive output.
  setTimeout(function () {
    doFit();
    send({ type: 'ready' });
  }, 0);
})();
`

// Escape a string for safe embedding inside a TS template literal: backslashes,
// backticks, and ${ interpolation starts. Applied to the inlined CSS/JS so the
// generated `export const TERMINAL_HTML = \`...\`` is syntactically valid.
function escapeForTemplateLiteral(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
${xtermCss}
html, body { margin: 0; padding: 0; height: 100%; background: #0c0d10; overflow: hidden; }
#term { position: absolute; inset: 0; padding: 6px; }
</style>
</head>
<body>
<div id="term"></div>
<script>${xtermJs}</script>
<script>${fitAddon}</script>
<script>${bridgeJs}</script>
</body>
</html>`

const out = `// @ts-nocheck
// GENERATED FILE — do not edit by hand.
// Produced by apps/mobile/scripts/gen-terminal-html.mjs (\`pnpm --filter @trux/mobile gen:terminal-html\`).
// A self-contained xterm.js terminal page (CSS + UMD JS inlined, no CDN) for the
// TerminalPane webview/iframe. Regenerate when @xterm/* deps change.
export const TERMINAL_HTML = \`${escapeForTemplateLiteral(html)}\`
`

const outPath = resolve(pkgRoot, 'src/components/terminalHtml.generated.ts')
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, out, 'utf8')

console.log(`wrote ${outPath} (${(out.length / 1024).toFixed(1)} KB)`)
