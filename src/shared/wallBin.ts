/** recently deleted: what left a wall and when, so it can come back after undo has moved on */

import { inPaintOrder, pruneArrows, topZ, type WallBinEntry, type WallItem } from './wallModel'

/** a month of deletions, but never an unbounded one */
export const BIN_DAYS = 30
export const BIN_ENTRIES = 30
export const BIN_ITEMS = 500

const DAY_MS = 86_400_000

const newBinId = (): string => `bin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/** only what's still gone; an undo that put items back leaves nothing of them to restore */
export function restorable(bin: WallBinEntry[] | undefined, items: WallItem[]): WallBinEntry[] {
  const present = new Set(items.map(i => i.id))
  return (bin ?? []).flatMap(entry => {
    const missing = entry.items.filter(i => !present.has(i.id))
    return missing.length > 0 ? [missing.length === entry.items.length ? entry : { ...entry, items: missing }] : []
  })
}

/** the removal first; entries back on the wall, past their time or over the limits drop off the end */
export function binRemoved(
  bin: WallBinEntry[] | undefined,
  removed: WallItem[],
  items: WallItem[],
  now: number,
  id: string = newBinId()
): WallBinEntry[] {
  const kept = restorable(bin, items).filter(entry => now - entry.at < BIN_DAYS * DAY_MS)
  const next = removed.length > 0 ? [{ id, at: now, items: removed }, ...kept] : kept

  const out: WallBinEntry[] = []
  let count = 0
  for (const entry of next) {
    // the newest always stays, deleting a lot at once is when it matters most
    if (out.length > 0 && (out.length >= BIN_ENTRIES || count + entry.items.length > BIN_ITEMS)) break
    out.push(entry)
    count += entry.items.length
  }
  return out
}

/** the entry's items back above everything, minus connectors whose other end isn't on the wall; null when it's not there to restore */
export function restoreEntry(
  bin: WallBinEntry[] | undefined,
  items: WallItem[],
  entryId: string
): { items: WallItem[]; bin: WallBinEntry[]; restored: WallItem[] } | null {
  const entry = restorable(bin, items).find(e => e.id === entryId)
  if (!entry) return null

  let z = topZ(items)
  const back = inPaintOrder(entry.items).map(item => ({ ...item, z: z++ }))
  const next = pruneArrows([...items, ...back])
  const present = new Set(next.map(i => i.id))
  return {
    items: next,
    // a connector left out stays out, the entry is done
    bin: restorable(bin, next).filter(e => e.id !== entryId),
    restored: back.filter(item => present.has(item.id))
  }
}
