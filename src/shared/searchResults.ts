/**
 * Merges results from the four things Checkpoint can search.
 *
 * Each source has its own index and its own idea of relevance, and FTS5 ranks a
 * card against other cards, not against a note. Rather than invent a
 * cross-source score, results interleave round-robin: twenty matching cards
 * must not bury the one note being looked for.
 */

export type SearchHitKind = 'card' | 'task' | 'log' | 'note' | 'cheatsheet'

export interface SearchHit {
  /** Stable within a result set; used as the React key and for dedupe. */
  id: string
  kind: SearchHitKind
  title: string
  /** A snippet or the workspace name. Whatever helps tell two hits apart. */
  subtitle?: string
  /** Carried through for the click handler; shape depends on the kind. */
  target?: string
}

/** How many hits any single source may contribute, before interleaving. */
export const PER_SOURCE_LIMIT = 5

/**
 * Round-robin merge, preserving each source's internal order.
 *
 * Empty groups are skipped rather than leaving gaps, so a search matching only
 * notes still fills the list with notes instead of showing five and stopping.
 */
export function interleave<T>(groups: T[][], limit: number): T[] {
  const queues = groups.filter(g => g.length > 0).map(g => [...g])
  const out: T[] = []

  while (out.length < limit && queues.length > 0) {
    for (let i = 0; i < queues.length && out.length < limit; ) {
      const next = queues[i].shift()
      if (next !== undefined) out.push(next)
      if (queues[i].length === 0) queues.splice(i, 1)
      else i++
    }
  }
  return out
}

/**
 * Caps each source, drops duplicate ids, then interleaves.
 *
 * Dedupe runs before interleaving so a hit appearing in two sources does not
 * consume two slots, and the first source to claim an id wins, which keeps the
 * caller's group order meaningful.
 */
export function mergeSearchHits(groups: SearchHit[][], limit = 12): SearchHit[] {
  const seen = new Set<string>()
  const capped = groups.map(group => {
    const kept: SearchHit[] = []
    for (const hit of group) {
      if (kept.length >= PER_SOURCE_LIMIT) break
      if (seen.has(hit.id)) continue
      seen.add(hit.id)
      kept.push(hit)
    }
    return kept
  })
  return interleave(capped, limit)
}

/** Short label shown beside a hit so its source is obvious at a glance. */
export function kindLabel(kind: SearchHitKind): string {
  switch (kind) {
    case 'card': return 'Card'
    case 'task': return 'Task'
    case 'log': return 'Log'
    case 'note': return 'Note'
    case 'cheatsheet': return 'Cheatsheet'
  }
}

/**
 * Collapses a match into one line.
 *
 * Snippets arrive with newlines and runs of whitespace from the source
 * document; left alone they break the single-line row layout.
 */
export function snippet(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
