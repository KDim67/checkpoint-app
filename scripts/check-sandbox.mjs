/** runs tests/electron/sandboxCheck.ts in electron, headless; needs a fresh build for the plugin preload, which check:sandbox makes and prepackage gets from verify */

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
// vite's own esbuild, which it pins, so nothing new to install
import { build } from 'esbuild'
import electron from 'electron'

// beside out/preload, which the sandbox looks for at ../preload from its own folder
const OUT_DIR = path.join('out', 'sandbox-check')
const BUNDLE = path.join(OUT_DIR, 'main.cjs')
const TIMEOUT_MS = 120_000

/** vite's ?raw, which the app's own build understands and esbuild doesn't */
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }))
  }
}

if (!fs.existsSync(path.join('out', 'preload', 'pluginHost.mjs'))) {
  console.error('out/preload/pluginHost.mjs is missing; run npm run build first.')
  process.exit(1)
}

await build({
  entryPoints: ['tests/electron/sandboxCheck.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'better-sqlite3'],
  outfile: BUNDLE,
  plugins: [raw],
  logLevel: 'warning'
})

const child = spawn(electron, [BUNDLE], { stdio: ['ignore', 'pipe', 'pipe'] })
// the plugins' own console lines are noise here; the check prints its verdicts on its own
const quiet = /^\[Plugin|^\[PluginRegistry|^\[plugin\]|Electron Security Warning|^\s*$/
const relay = stream => chunk => {
  for (const line of chunk.toString().split(/\r?\n/)) if (!quiet.test(line)) stream.write(`${line}\n`)
}
child.stdout.on('data', relay(process.stdout))
child.stderr.on('data', relay(process.stderr))

const timer = setTimeout(() => {
  console.error(`The sandbox check did not finish within ${TIMEOUT_MS / 1000} seconds.`)
  child.kill()
}, TIMEOUT_MS)

child.on('exit', code => {
  clearTimeout(timer)
  // out/ ships in the installer, so nothing of the check may stay there
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  process.exit(code ?? 1)
})
