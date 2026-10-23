import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? sources(join(dir, item.name)) : /\.(tsx?|css)$/.test(item.name) ? [join(dir, item.name)] : []
  )
}

describe('CSS custom property names', () => {
  it('never hold a dot, which CSS drops without a word so the padding or gap silently becomes nothing', () => {
    const dotted = sources('src/renderer/src').flatMap(file =>
      (readFileSync(file, 'utf8').match(/--[\w-]*\d\.\d[\w-]*/g) ?? []).map(name => `${file}: ${name}`)
    )
    expect(dotted).toEqual([])
  })

  it('are all defined somewhere, since an unknown one also resolves to nothing without a word', () => {
    const files = sources('src/renderer/src').map(file => ({ file, text: readFileSync(file, 'utf8') }))
    const defined = new Set(files.flatMap(({ text }) => [
      // declared in a stylesheet or a style object, or set inline as a key
      ...Array.from(text.matchAll(/(--[\w-]+)\s*:/g), match => match[1]),
      ...Array.from(text.matchAll(/['"](--[\w-]+)['"]/g), match => match[1])
    ]))
    const unknown = files.flatMap(({ file, text }) =>
      // a name the code finishes at run time, such as --cal-layer- and the layer, is followed by neither
      Array.from(text.matchAll(/var\((--[\w-]+)(?=[\s,)])/g), match => match[1])
        .filter(name => !defined.has(name))
        .map(name => `${file}: ${name}`)
    )
    expect(unknown).toEqual([])
  })
})
