import { useState, useEffect } from 'react'
import { str } from './aiActionTypes'
import { readItems } from '../../data/items'

// card titles in replies become #card: links; cached per context with a short TTL, cleared on kanban-refresh
let boardTitlesCache: { ctx: string; ts: number; entries: Array<{ title: string; id: string }> } | null = null
// single-flight so every message gets titles in one batch, or the chat bounces
let boardTitlesPromise: { ctx: string; promise: Promise<Array<{ title: string; id: string }>> } | null = null

function fetchBoardTitles(context: string): Promise<Array<{ title: string; id: string }>> {
  if (boardTitlesCache && boardTitlesCache.ctx === context && Date.now() - boardTitlesCache.ts < 15000) {
    return Promise.resolve(boardTitlesCache.entries)
  }
  if (boardTitlesPromise && boardTitlesPromise.ctx === context) {
    return boardTitlesPromise.promise
  }
  const promise = (async () => {
    try {
      const [t, c] = await Promise.all([
        readItems(context, 'task').catch(() => []),
        readItems(context, 'card').catch(() => [])
      ])
      const items = [...(t || []), ...(c || [])].filter(i => i.status !== 'archived')
      const list = items
        .map(i => ({ title: str(i.title).trim(), id: i.id }))
        // short titles false-positive, markdown chars break links
        .filter(e => e.title.length >= 5 && !/[[\]()`*_]/.test(e.title))
        .sort((a, b) => b.title.length - a.title.length)
        .slice(0, 80)
      boardTitlesCache = { ctx: context, ts: Date.now(), entries: list }
      return list
    } catch {
      return boardTitlesCache?.entries || []
    } finally {
      boardTitlesPromise = null
    }
  })()
  boardTitlesPromise = { ctx: context, promise }
  return promise
}

export function useBoardTitles(context: string, enabled: boolean): Array<{ title: string; id: string }> {
  const [entries, setEntries] = useState<Array<{ title: string; id: string }>>(
    boardTitlesCache && boardTitlesCache.ctx === context ? boardTitlesCache.entries : []
  )
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = (): void => {
      fetchBoardTitles(context).then(list => { if (!cancelled) setEntries(list) })
    }
    load()
    const onRefresh = (): void => { boardTitlesCache = null; load() }
    window.addEventListener('kanban-refresh', onRefresh)
    return () => { cancelled = true; window.removeEventListener('kanban-refresh', onRefresh) }
  }, [context, enabled])
  return entries
}
