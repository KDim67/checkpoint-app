/** the window's own minimise, maximise and close buttons wear the title bar's colours, read from the page as drawn so every way of changing the theme is covered */

import { useEffect, type RefObject } from 'react'
import * as appApi from '../data/app'

interface Rgba { r: number; g: number; b: number; a: number }

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

const byte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))
const unit = (n: number): number => Math.max(0, Math.min(1, n))

/** a channel as rgb() writes it, a number or a percentage of 255 */
const channel = (part: string): number => (part.endsWith('%') ? parseFloat(part) * 2.55 : parseFloat(part))
const alphaOf = (part: string | undefined): number =>
  part === undefined ? 1 : part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part)

/** a colour as the browser hands it back; null for one it can't be read from, which then counts as see-through */
export function readCssColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map(d => d + d).join('') : hex[1]
    if (digits.length !== 6 && digits.length !== 8) return null
    const at = (i: number): number => parseInt(digits.slice(i, i + 2), 16)
    return { r: at(0), g: at(2), b: at(4), a: digits.length === 8 ? at(6) / 255 : 1 }
  }

  // rgb(1, 2, 3), rgba(1, 2, 3, 0.5) and rgb(1 2 3 / 50%), and color-mix's color(srgb 0.1 0.2 0.3)
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text)
  const srgb = /^color\(srgb\s+([^)]+)\)$/.exec(text)
  const body = rgb?.[1] ?? srgb?.[1]
  if (!body) return null
  const parts = body.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const [r, g, b] = parts.slice(0, 3).map(p => (srgb && !p.endsWith('%') ? parseFloat(p) * 255 : channel(p)))
  const a = alphaOf(parts[3])
  if (![r, g, b, a].every(Number.isFinite)) return null
  return { r: byte(r), g: byte(g), b: byte(b), a: unit(a) }
}

/** a see-through colour laid over the one under it */
const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1
})

const hexOf = (c: Rgba): string => `#${[c.r, c.g, c.b].map(n => byte(n).toString(16).padStart(2, '0')).join('')}`

/** what shows at the element, through its see-through layers down to the first solid one; the page is white underneath */
function backgroundAt(el: Element): Rgba {
  const layers: Rgba[] = []
  for (let node: Element | null = el; node; node = node.parentElement) {
    const colour = readCssColor(getComputedStyle(node).backgroundColor)
    if (!colour || colour.a === 0) continue
    layers.push(colour)
    if (colour.a >= 1) break
  }
  return layers.reduceRight((under, top) => over(top, under), WHITE)
}

/** the bar's background behind the buttons, and its text for their marks, as plain hex the window takes */
export function titleBarColors(bar: HTMLElement): { color: string; symbolColor: string } {
  const background = backgroundAt(bar)
  const text = readCssColor(getComputedStyle(bar).color) ?? { r: 0, g: 0, b: 0, a: 1 }
  return { color: hexOf(background), symbolColor: hexOf(over(text, background)) }
}

/** tells the window the bar's colours on opening and whenever the theme could have changed, but only when they did */
export function useTitleBarColors(bar: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = bar.current
    if (!enabled || !el) return
    let last = ''
    const report = (): void => {
      const colors = titleBarColors(el)
      const key = `${colors.color} ${colors.symbolColor}`
      if (key === last) return
      last = key
      appApi.setTitleBarColors(colors)
    }
    report()

    // a theme is attributes on the page and stylesheets in its head, whether the palette, Settings, the customizer or a plugin set it
    const observer = new MutationObserver(report)
    observer.observe(document.documentElement, { attributes: true })
    observer.observe(document.body, { attributes: true })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    window.addEventListener('theme-mode-changed', report)
    // a theme that fades its colours in is read once the fade ends
    el.addEventListener('transitionend', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('theme-mode-changed', report)
      el.removeEventListener('transitionend', report)
    }
  }, [bar, enabled])
}
