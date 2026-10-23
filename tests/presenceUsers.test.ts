import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

const ROOT = 'src/renderer/src'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? sources(join(dir, item.name)) : /\.tsx$/.test(item.name) ? [join(dir, item.name)] : []
  )
}

/** the file a component name is imported from, as written in the file using it */
function fileOf(user: string, text: string, name: string): string | null {
  // a plain import, or one loaded only when first shown
  const match = new RegExp(`import ${name}\\b[^\\n]*from '([^']+)'`).exec(text)
    ?? new RegExp(`const ${name} = lazy\\(\\(\\) => import\\('([^']+)'\\)\\)`).exec(text)
  if (!match) return null
  const base = resolve(dirname(user), match[1])
  return [`${base}.tsx`, `${base}/index.tsx`].find(existsSync) ?? null
}

/** it plays its own exit, or draws itself in a frame that does */
const playsExit = (text: string): boolean =>
  // its dim backdrop and its panel both leave, or the dim lingers a beat after the panel has gone
  (/usePresenceState\(\)/.test(text) && (text.match(/data-state=\{presence\}/g) ?? []).length >= 2) || /<ModalShell|<ChatPanelModal/.test(text)

describe('what Presence keeps on screen while it leaves', () => {
  it('can play an exit, or it would sit there unmoving and then vanish', () => {
    const wrapped: string[] = []
    const missing: string[] = []
    for (const file of sources(ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/<Presence show=[^>]*>\s*\{[^{}]*?&&\s*\(?\s*<(?:Suspense[^>]*>\s*<)?([A-Z]\w+)/g)) {
        const name = match[1]
        wrapped.push(name)
        const component = fileOf(file, text, name)
        if (!component || !playsExit(readFileSync(component, 'utf8'))) missing.push(`${name} in ${file}`)
      }
    }
    expect(wrapped.length).toBeGreaterThan(15)
    expect(missing).toEqual([])
  })
})
