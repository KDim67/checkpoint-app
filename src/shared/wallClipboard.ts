/** copy and paste on the wall: what a selection takes with it, where the copies land, and what other apps get */

import {
  boundsOf, inPaintOrder, normalizeWallItem, pruneArrows, topZ, withFrameContents,
  type ArrowHeads, type ArrowLine, type ArrowShape, type Point, type WallItem
} from './wallModel'
import { parseWallLink } from './wallLink'
import { plainWallText } from './wallText'
import { regroupCopies } from './wallGroup'

// private, so a paste from another app can't pose as wall items
export const WALL_CLIP_MIME = 'application/x-checkpoint-wall-items'

export interface WallClip {
  version: 1
  items: WallItem[]
}

const centreOf = (item: WallItem): Point => ({ x: item.x + item.width / 2, y: item.y + item.height / 2 })

/** copies arrive unlocked like duplicates, so a locked background's copy can be moved */
function unlocked(item: WallItem): WallItem {
  const copy = { ...item }
  delete copy.locked
  return copy
}

/** a frame brings what's in it, connectors come when their items do; null when nothing is picked */
export function clipSelection(items: WallItem[], selected: Set<string>): WallClip | null {
  const chosen = withFrameContents(items, selected)
  const byId = new Map(items.map(i => [i.id, i]))
  const inside = new Set(items.filter(i => chosen.has(i.id) && i.kind !== 'arrow').map(i => i.id))

  const copied = inPaintOrder(items).flatMap((item): WallItem[] => {
    if (item.kind !== 'arrow') return inside.has(item.id) ? [unlocked(item)] : []

    const ends = [item.from, item.to].filter((id): id is string => !!id)
    // an unpicked connector comes only when every item it touches does
    if (!chosen.has(item.id)) return ends.length > 0 && ends.every(id => inside.has(id)) ? [unlocked(item)] : []

    // a picked one keeps an end whose item stays behind, pinned where that item was
    const copy = unlocked(item)
    for (const end of ['from', 'to'] as const) {
      const id = copy[end]
      if (!id || inside.has(id)) continue
      const anchor = byId.get(id)
      if (!anchor) return []
      delete copy[end]
      copy[end === 'from' ? 'fromPoint' : 'toPoint'] = centreOf(anchor)
    }
    return [copy]
  })

  return copied.length > 0 ? { version: 1, items: copied } : null
}

const freshId = (): string => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** centred on the point with fresh ids, stacked above the wall in their own order; connectors follow their copies */
export function placeClip(clip: WallClip, existing: WallItem[], at: Point, newId: () => string = freshId): WallItem[] {
  const bounds = boundsOf(clip.items)
  if (!bounds) return []

  const dx = at.x - (bounds.minX + bounds.maxX) / 2
  const dy = at.y - (bounds.minY + bounds.maxY) / 2
  const ids = new Map(clip.items.map(i => [i.id, newId()]))

  const placed: WallItem[] = []
  let z = topZ(existing)
  for (const item of inPaintOrder(clip.items)) {
    const from = item.from ? ids.get(item.from) : undefined
    const to = item.to ? ids.get(item.to) : undefined
    // an end on an item that didn't come along can't be drawn
    if (item.kind === 'arrow' && ((item.from && !from) || (item.to && !to))) continue

    const copy = unlocked({ ...item, id: ids.get(item.id) as string, x: item.x + dx, y: item.y + dy, z: z++ })
    if (from) copy.from = from
    if (to) copy.to = to
    if (item.fromPoint) copy.fromPoint = { x: item.fromPoint.x + dx, y: item.fromPoint.y + dy }
    if (item.toPoint) copy.toPoint = { x: item.toPoint.x + dx, y: item.toPoint.y + dy }
    placed.push(copy)
  }
  return regroupCopies(placed)
}

export type Direction = 'up' | 'down' | 'left' | 'right'

/** Alt and an arrow: a copy laid beside the selection a gap away, bringing what a copy would */
export function duplicateToward(
  items: WallItem[],
  selected: Set<string>,
  direction: Direction,
  gap = 24,
  newId: () => string = freshId
): WallItem[] {
  const clip = clipSelection(items, selected)
  const bounds = clip ? boundsOf(clip.items) : null
  if (!clip || !bounds) return []
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const dx = direction === 'right' ? width + gap : direction === 'left' ? -(width + gap) : 0
  const dy = direction === 'down' ? height + gap : direction === 'up' ? -(height + gap) : 0
  return placeClip(clip, items, { x: (bounds.minX + bounds.maxX) / 2 + dx, y: (bounds.minY + bounds.maxY) / 2 + dy }, newId)
}

export const encodeClip = (clip: WallClip): string => JSON.stringify(clip)

/** only what a copy wrote; items are normalised like a stored wall, so a crafted clip can't carry junk in */
export function decodeClip(raw: string | null | undefined): WallClip | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const { version, items } = parsed as { version?: unknown; items?: unknown }
  if (version !== 1 || !Array.isArray(items)) return null

  const kept = pruneArrows(
    items.map((entry, i) => normalizeWallItem(entry, i)).filter((i): i is WallItem => i !== null)
  )
  return kept.length > 0 ? { version: 1, items: kept } : null
}

/** what other apps get: the words in reading order, web links spelled out */
export function clipText(clip: WallClip, titleOf: (item: WallItem) => string | undefined): string {
  return clip.items
    .filter(i => i.kind !== 'arrow' && i.kind !== 'ink' && i.kind !== 'image')
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(item => {
      const words = item.kind === 'note' || item.kind === 'text' || item.kind === 'shape'
        ? plainWallText(item.text ?? '')
        : (titleOf(item) ?? item.text ?? '')
      const link = parseWallLink(item.link)
      return [words.trim(), link?.type === 'url' ? link.url : ''].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

export interface WallStyle {
  color?: string
  strokeWidth?: number
  arrowShape?: ArrowShape
  arrowLine?: ArrowLine
  arrowHeads?: ArrowHeads
}

const drawsLines = (item: WallItem): boolean => item.kind === 'arrow' || item.kind === 'ink'

/** what Copy style carries; absent looks are recorded too, so pasting resets them to the default */
export function styleOf(item: WallItem): WallStyle {
  return {
    color: item.color,
    ...(drawsLines(item) ? { strokeWidth: item.strokeWidth } : {}),
    ...(item.kind === 'arrow' ? { arrowShape: item.arrowShape, arrowLine: item.arrowLine, arrowHeads: item.arrowHeads } : {})
  }
}

/** locked items keep their looks; a look the source's kind doesn't have is left as it was */
export function applyStyle(items: WallItem[], ids: Set<string>, style: WallStyle): WallItem[] {
  const take = <K extends keyof WallStyle>(target: WallItem, key: K): void => {
    if (!(key in style)) return
    if (style[key] === undefined) delete target[key]
    else (target as WallStyle)[key] = style[key]
  }

  return items.map(item => {
    if (!ids.has(item.id) || item.locked) return item
    const next = { ...item }
    take(next, 'color')
    if (drawsLines(item)) take(next, 'strokeWidth')
    if (item.kind === 'arrow') {
      take(next, 'arrowShape')
      take(next, 'arrowLine')
      take(next, 'arrowHeads')
    }
    return next
  })
}
