import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'

const ROOT = 'src/renderer/src'
const css = readFileSync(`${ROOT}/index.css`, 'utf8')

function components(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const path = join(dir, item.name)
    if (item.isDirectory()) return components(path)
    return path.endsWith('.tsx') ? [{ file: relative(ROOT, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }] : []
  })
}

/** the declarations of one rule, by its exact selector */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('where the keyboard is', () => {
  it('shows on every shared field style, none of which switches the outline off', () => {
    for (const selector of ['.input-xs', '.input-sm', '.input-md', '.input-fill', '.select-sm', '.select-md']) {
      expect(rule(selector), selector).not.toMatch(/outline:\s*none/)
    }
  })

  it('is drawn over a field\'s own border, so a panel that clips its edges never cuts it off', () => {
    expect(css).toMatch(/:is\(input:not\(\[type="checkbox"\], \[type="radio"\], \[type="range"\], \[type="color"\]\), select, textarea\):focus-visible \{\s*outline-offset: -1px;/)
  })

  it('is never hidden on a bordered field that draws no focus of its own', () => {
    // these draw their own focus: a border that lights up, or an editing frame around them
    const OWN_FOCUS = ['components/ui/DetailTitleInput.tsx', 'components/kanban/KanbanCard.tsx', 'components/wall/WallCodeBlock.tsx', 'components/ItemDetailPanel.tsx']
    const hidden: string[] = []
    for (const { file, text } of components(ROOT)) {
      if (OWN_FOCUS.includes(file)) continue
      for (const match of text.matchAll(/outline: 'none'/g)) {
        const at = match.index ?? 0
        const tagAt = text.lastIndexOf('<', at)
        const tag = /^<(input|select|textarea)\b/.exec(text.slice(tagAt))?.[1]
        if (!tag) continue
        const style = text.slice(text.lastIndexOf('{', at), text.indexOf('}', at))
        const element = text.slice(tagAt, text.indexOf('}', at))
        const borderless = /border: 'none'/.test(style)
        const ownFocus = /onFocus|focus-border|focused|isFocused/.test(element)
        if (!borderless && !ownFocus) hidden.push(`${file}:${text.slice(0, at).split('\n').length} <${tag}>`)
      }
    }
    expect(hidden).toEqual([])
  })
})

describe('the Font size setting', () => {
  it('scales every size in the ramp, the two shorthand names included', async () => {
    const source = readFileSync(`${ROOT}/lib/fontScale.ts`, 'utf8')
    const scaled = Array.from(source.matchAll(/'(--text-[\w-]+)':/g), match => match[1])
    const declared = Array.from(css.matchAll(/^\s*(--text-[\w-]+):\s*([^;]+);/gm), match => ({ name: match[1], value: match[2].trim() }))
    expect(declared.length).toBeGreaterThan(7)
    for (const { name, value } of declared) {
      // either rescaled by the setting, or another size's alias, which follows it
      expect(scaled.includes(name) || /^var\(--text-[\w-]+\)$/.test(value), `${name}: ${value}`).toBe(true)
    }
  })

  it('reaches the stylesheet\'s text, all but what the wall draws on its zoomable canvas', () => {
    const WALL_CANVAS = ['.wall-link-chip', '.wall-code-block', '.wall-code-block-head', '.wall-tag-chip', '.wall-link-action']
    const fixed = Array.from(css.matchAll(/\n([^\n{}]+) \{[^}]*?font-size:\s*\d+(\.\d+)?px/g), match => match[1].trim())
    expect(fixed.filter(selector => !WALL_CANVAS.includes(selector))).toEqual([])
  })

  it('reaches the components\' text, all but the wall\'s canvas and the fixed-size desktop widget', () => {
    const SKIP = ['components/wall/WallItemView.tsx', 'components/wall/WallCanvas.tsx', 'components/wall/WallCodeBlock.tsx', 'components/WidgetView.tsx']
    const small = components(ROOT)
      .filter(({ file }) => !SKIP.includes(file))
      .flatMap(({ file, text }) => Array.from(text.matchAll(/(fontSize: '|font-size: )(\d+(?:\.\d+)?)px/g), match => ({ file, px: parseFloat(match[2]) })))
      .filter(({ px }) => px < 12)
      .map(({ file, px }) => `${file}: ${px}px`)
    expect(small).toEqual([])
  })

  it('dims faint captions by colour, which stays legible, rather than by opacity', () => {
    expect(rule('.text-micro-dim')).not.toMatch(/opacity/)
    expect(rule('.text-micro-dim')).toMatch(/color: var\(--color-text-muted\)/)
  })
})
