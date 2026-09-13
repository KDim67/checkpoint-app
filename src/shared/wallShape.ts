/** shapes on the wall, switching between the kinds that hold words, and those words becoming a card */

import { DEFAULT_SIZES, type ShapeType, type WallItem } from './wallModel'
import { plainWallText } from './wallText'

/** two decimals, paths stay short on odd sizes */
const n = (value: number): number => Math.round(value * 100) / 100

/** in the item's own box, a pixel in so a two-pixel border isn't clipped by it */
export function shapeOutline(shape: ShapeType, width: number, height: number): string {
  const l = 1
  const t = 1
  const r = n(width - 1)
  const b = n(height - 1)
  const w = r - l
  const h = b - t
  const cx = n(l + w / 2)
  const cy = n(t + h / 2)

  switch (shape) {
    case 'rounded': {
      // a deep corner on a thin box would meet itself
      const k = Math.min(16, w / 4, h / 4)
      return `M${n(l + k)},${t}H${n(r - k)}Q${r},${t} ${r},${n(t + k)}V${n(b - k)}Q${r},${b} ${n(r - k)},${b}` +
        `H${n(l + k)}Q${l},${b} ${l},${n(b - k)}V${n(t + k)}Q${l},${t} ${n(l + k)},${t}Z`
    }
    case 'oval':
      return `M${l},${cy}A${n(w / 2)},${n(h / 2)} 0 1 0 ${r},${cy}A${n(w / 2)},${n(h / 2)} 0 1 0 ${l},${cy}Z`
    case 'diamond':
      return `M${cx},${t}L${r},${cy}L${cx},${b}L${l},${cy}Z`
    case 'triangle':
      return `M${cx},${t}L${r},${b}L${l},${b}Z`
    default:
      return `M${l},${t}H${r}V${b}H${l}Z`
  }
}

/** percent in from each side; a diamond's corners and a triangle's point leave no room for words */
export function shapeTextBox(shape: ShapeType): { top: number; right: number; bottom: number; left: number } {
  switch (shape) {
    case 'oval':
      return { top: 15, right: 15, bottom: 15, left: 15 }
    case 'diamond':
      return { top: 25, right: 25, bottom: 25, left: 25 }
    case 'triangle':
      return { top: 45, right: 22, bottom: 8, left: 22 }
    default:
      return { top: 8, right: 8, bottom: 8, left: 8 }
  }
}

export type WritableKind = 'note' | 'text' | 'shape'

export const isWritable = (kind: string): kind is WritableKind => kind === 'note' || kind === 'text' || kind === 'shape'

/** same id, so arrows stay attached; colour travels between fills, never onto text where it would be the letters */
export function switchKinds(items: WallItem[], ids: Set<string>, kind: WritableKind): WallItem[] {
  return items.map(item => {
    if (!ids.has(item.id) || item.locked || !isWritable(item.kind) || item.kind === kind) return item

    const next: WallItem = { ...item, kind }
    delete next.shape
    if (item.kind === 'text' || kind === 'text') delete next.color

    // a line of text is too thin for a sticky or a shape, it gets their size around the same centre
    if (item.kind === 'text') {
      const size = DEFAULT_SIZES[kind]
      next.x = item.x + item.width / 2 - size.width / 2
      next.y = item.y + item.height / 2 - size.height / 2
      next.width = size.width
      next.height = size.height
    }
    return next
  })
}

/** first line for the title, the rest as written for the description, which the board reads as markdown */
export function cardFromText(text: string): { title: string; body: string } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex(line => line.trim())
  if (first === -1) return { title: 'New card', body: '' }

  // the line's words, without its list marker or formatting
  const title = plainWallText(lines[first]).replace(/^\s*(•|\d+\.)\s+/, '').trim().slice(0, 200)
  return { title: title || 'New card', body: lines.slice(first + 1).join('\n').trim() }
}
