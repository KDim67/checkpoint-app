/** round-robin across sources, FTS only ranks within a source */

type SearchHitKind = 'card' | 'task' | 'log' | 'note' | 'cheatsheet'

export interface SearchHit {
  /** stable per result set, React key and dedupe */
  id: string
  kind: SearchHitKind
  title: string
  /** whatever tells two hits apart */
  subtitle?: string
  /** shape depends on the kind */
  target?: string
}

/** per source, before interleaving */
export const PER_SOURCE_LIMIT = 5

/** empty groups skipped so notes-only searches still fill the list */
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

/** dedupe before interleave so one hit doesn't take two slots; first source wins */
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

/** so the source is obvious */
export function kindLabel(kind: SearchHitKind): string {
  switch (kind) {
    case 'card': return 'Card'
    case 'task': return 'Task'
    case 'log': return 'Log'
    case 'note': return 'Note'
    case 'cheatsheet': return 'Cheatsheet'
  }
}

/** one line, source newlines break the row */
export function snippet(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
