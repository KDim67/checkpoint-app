/**
 * One query across everything Checkpoint indexes. The four searches already
 * existed and were simply never called together: run them in parallel, map to a
 * common shape, let `mergeSearchHits` order them.
 *
 * Each source may fail on its own. Cheatsheet search reads PDFs and note search
 * walks a directory, and one bad source must not blank the whole list.
 */

import { mergeSearchHits, snippet, type SearchHit } from '../../../shared/searchResults'
import type { Item, NoteSearchResult } from '../../../shared/types'

/** Minimum length before searching. FTS on one character matches everything. */
export const MIN_QUERY_LENGTH = 2

const itemKind = (item: Item): SearchHit['kind'] =>
  item.type === 'log' ? 'log' : item.type === 'task' ? 'task' : 'card'

async function settled<T>(label: string, work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work
  } catch (err) {
    console.error(`[search] ${label} failed:`, err)
    return fallback
  }
}

export async function searchEverything(query: string, context: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < MIN_QUERY_LENGTH) return []

  const [items, notes, cheatsheets] = await Promise.all([
    settled(
      'items',
      window.electronAPI.db.searchItems({ query: q, context, pageSize: 8 }),
      { items: [] as Item[], total: 0, page: 1, pageSize: 8 }
    ),
    settled('notes', window.electronAPI.notes.searchNotes(q), [] as NoteSearchResult[]),
    settled(
      'cheatsheets',
      window.electronAPI.cheatsheets.search(q),
      [] as Array<{ name: string; matchCount: number; snippets: string[] }>
    )
  ])

  const itemHits: SearchHit[] = items.items.map(item => ({
    id: `item:${item.id}`,
    kind: itemKind(item),
    title: item.title || '(untitled)',
    subtitle: item.body ? snippet(item.body) : undefined,
    target: item.id
  }))

  const noteHits: SearchHit[] = notes.map(note => ({
    id: `note:${note.title}`,
    kind: 'note',
    title: note.title,
    subtitle: note.snippet ? snippet(note.snippet) : undefined,
    target: note.title
  }))

  const sheetHits: SearchHit[] = cheatsheets.map(sheet => ({
    id: `cheatsheet:${sheet.name}`,
    kind: 'cheatsheet',
    title: sheet.name,
    subtitle: snippet(sheet.snippets?.[0] ?? `${sheet.matchCount} matches`),
    target: sheet.name
  }))

  return mergeSearchHits([itemHits, noteHits, sheetHits])
}
