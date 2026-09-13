/** MIT/ISC/BSD/OFL notices must ship with the binary; generated since a hand-kept list rots */

import fs from 'fs'
import path from 'path'

const OUT = path.join('resources', 'THIRD-PARTY-LICENSES.txt')

/** vite bundles these into the renderer, so they ship despite being devDependencies */
const RENDERER_BUNDLED = [
  '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities',
  '@fontsource/inter', '@fontsource/jetbrains-mono',
  'date-fns', 'immer', 'lucide-react', 'mermaid',
  'react', 'react-dom', 'react-markdown', 'remark-gfm', 'three', 'zustand'
]

const LICENCE_FILENAMES = [
  'LICENSE', 'LICENCE', 'LICENSE.md', 'LICENCE.md', 'LICENSE.txt', 'LICENCE.txt',
  'license', 'licence', 'license.md', 'licence.md', 'license.txt', 'licence.txt',
  'LICENSE-MIT', 'COPYING'
]

const readLicenceText = (dir) => {
  for (const name of LICENCE_FILENAMES) {
    const file = path.join(dir, name)
    try {
      if (fs.statSync(file).isFile()) return fs.readFileSync(file, 'utf8').trim()
    } catch {
      // not this one
    }
  }
  return null
}

const declaredLicence = (meta) => {
  if (typeof meta.license === 'string') return meta.license
  if (meta.license?.type) return meta.license.type
  if (Array.isArray(meta.licenses)) return meta.licenses.map(l => l.type).join(' OR ')
  return 'see the notice below'
}

const packages = new Map()

const walk = (name) => {
  if (packages.has(name)) return
  const dir = path.join('node_modules', name)

  let meta
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return
  }

  packages.set(name, {
    version: meta.version ?? '',
    licence: declaredLicence(meta),
    text: readLicenceText(dir),
    homepage: meta.homepage ?? (typeof meta.repository === 'string' ? meta.repository : meta.repository?.url) ?? ''
  })

  for (const dep of Object.keys(meta.dependencies ?? {})) walk(dep)
}

const root = JSON.parse(fs.readFileSync('package.json', 'utf8'))
for (const name of [...Object.keys(root.dependencies ?? {}), ...RENDERER_BUNDLED]) walk(name)

const names = [...packages.keys()].sort()
const lines = [
  'THIRD-PARTY SOFTWARE NOTICES',
  '',
  `${root.productName ?? root.name} bundles the open-source packages listed below.`,
  'Each remains under its own licence, reproduced here as those licences require.',
  '',
  `Generated from the dependency tree by scripts/third-party-licences.mjs.`,
  `${names.length} packages.`,
  '',
  '='.repeat(78),
  'SUMMARY',
  '='.repeat(78),
  ''
]

for (const name of names) {
  const p = packages.get(name)
  lines.push(`${name}@${p.version}, ${p.licence}`)
}

lines.push('', '='.repeat(78), 'FULL LICENCE TEXTS', '='.repeat(78), '')

// shared licence texts print once with their package list
const byText = new Map()
for (const name of names) {
  const p = packages.get(name)
  const key = p.text ?? `NO LICENCE FILE SHIPPED (declared: ${p.licence})`
  const group = byText.get(key) ?? []
  group.push(`${name}@${p.version}`)
  byText.set(key, group)
}

for (const [text, covered] of [...byText].sort((a, b) => b[1].length - a[1].length)) {
  lines.push('-'.repeat(78))
  lines.push(`Applies to: ${covered.join(', ')}`)
  lines.push('-'.repeat(78))
  lines.push('')
  lines.push(text)
  lines.push('')
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log(`wrote ${OUT}: ${names.length} packages, ${byText.size} distinct notices`)
