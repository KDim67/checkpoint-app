/** Find on this wall: words across the wall, narrowed to one kind of thing */

import { inPaintOrder, searchItems, type WallItem, type WallItemKind } from './wallModel'

/** arrows and strokes have nothing to find them by */
export type SearchKind = 'all' | Exclude<WallItemKind, 'arrow' | 'ink'>

export const SEARCH_KINDS: { kind: SearchKind; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'note', label: 'Stickies' },
  { kind: 'text', label: 'Text' },
  { kind: 'shape', label: 'Shapes' },
  { kind: 'card', label: 'Cards' },
  { kind: 'doc', label: 'Notes' },
  { kind: 'image', label: 'Images' },
  { kind: 'bookmark', label: 'Links' },
  { kind: 'frame', label: 'Frames' }
]

/** whether the wall should dim what doesn't match */
export const isSearching = (query: string, kind: SearchKind): boolean => query.trim() !== '' || kind !== 'all'

/** topmost first; a kind with no words lists every item of that kind */
export function findItems(
  items: WallItem[],
  query: string,
  kind: SearchKind,
  titleOf: (item: WallItem) => string | undefined
): WallItem[] {
  const ofKind = kind === 'all' ? items : items.filter(i => i.kind === kind)
  if (query.trim()) return searchItems(ofKind, query, titleOf)
  return kind === 'all' ? [] : inPaintOrder(ofKind).reverse()
}
