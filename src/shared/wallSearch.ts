/** walls in the palette's search: a wall by its name, and what is written on any of them */

import { searchItems, type WallItem, type WallRef } from './wallModel'
import { itemLink } from './wallLink'
import { snippet, type SearchHit } from './searchResults'

/** a wall's own link, with no item: open that wall where it was left */
export const wallLink = (wallId: string): string => `wall:${wallId}`

/** the wall a bare wall link names, null for anything else */
export function wallIdOf(link: string): string | null {
  const m = /^wall:([A-Za-z0-9_-]+)$/.exec(link)
  return m ? m[1] : null
}

/** what an item is found by: its own words, and for a picture the name of its file */
const wordsOf = (item: WallItem): string | undefined => item.text

export function wallSearchHits(walls: { ref: WallRef; items: WallItem[] }[], query: string): SearchHit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const named: SearchHit[] = walls
    .filter(({ ref }) => words.every(w => ref.name.toLowerCase().includes(w)))
    .map(({ ref }) => ({ id: `wall:${ref.id}`, kind: 'wall', title: ref.name, subtitle: 'A wall', target: wallLink(ref.id) }))

  const written: SearchHit[] = walls.flatMap(({ ref, items }) =>
    searchItems(items, query, wordsOf)
      // a stroke or an arrow has no words of its own to show
      .filter(item => (item.text ?? '').trim())
      .map(item => ({
        id: `wall:${ref.id}/${item.id}`,
        kind: 'wall' as const,
        title: snippet(item.text ?? ''),
        subtitle: `On ${ref.name}`,
        target: itemLink(ref.id, item.id)
      }))
  )

  return [...named, ...written]
}
