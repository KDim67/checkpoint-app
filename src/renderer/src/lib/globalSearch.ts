/** the searches in parallel, merged by mergeSearchHits; each source can fail alone */

import { mergeSearchHits, snippet, type SearchHit } from '../../../shared/searchResults'
import type { Item, NoteSearchResult } from '../../../shared/types'
import { searchItems } from '../data/items'
import * as notesApi from '../data/notes'
import * as cheatsheetsApi from '../data/cheatsheets'
import { loadWallDoc, loadWallIndex } from './wallDoc'
import { wallDocKey, type WallItem, type WallRef } from '../../../shared/wallModel'
import { wallSearchHits } from '../../../shared/wallSearch'
import * as renewalsApi from '../data/renewals'
import { expiryPhrase } from '../../../shared/renewal'
import type { RenewalRecord } from '../../../shared/renewalApi'

/** FTS on one character matches everything */
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

/** every wall of the workspace with what is on it, read fresh each search */
async function wallsOf(context: string): Promise<{ ref: WallRef; items: WallItem[] }[]> {
  const index = await loadWallIndex(context)
  return Promise.all(index.walls.map(async ref => ({ ref, items: (await loadWallDoc(wallDocKey(context, ref.id))).items })))
}

export async function searchEverything(query: string, context: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < MIN_QUERY_LENGTH) return []

  const [items, notes, cheatsheets, walls, renewals] = await Promise.all([
    settled(
      'items',
      searchItems({ query: q, context, pageSize: 8 }),
      { items: [] as Item[], total: 0, page: 1, pageSize: 8 }
    ),
    settled('notes', notesApi.searchNotes(q), [] as NoteSearchResult[]),
    settled(
      'cheatsheets',
      cheatsheetsApi.search(q),
      [] as Array<{ name: string; matchCount: number; snippets: string[] }>
    ),
    settled('walls', wallsOf(context), [] as { ref: WallRef; items: WallItem[] }[]),
    // every workspace, as the Renewals screen shows them; few enough to match here
    settled('renewals', renewalsApi.list().then(r => (r.ok ? r.value : [])), [] as RenewalRecord[])
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

  const needle = q.toLowerCase()
  const now = Date.now()
  const renewalHits: SearchHit[] = renewals
    .filter(r => `${r.title} ${r.body}`.toLowerCase().includes(needle))
    .map(r => ({
      id: `renewal:${r.id}`,
      kind: 'renewal',
      title: r.title,
      subtitle: r.meta.expiresAt === null ? undefined : expiryPhrase(r.meta.expiresAt, now),
      target: r.id
    }))

  return mergeSearchHits([itemHits, noteHits, sheetHits, wallSearchHits(walls, q), renewalHits])
}
