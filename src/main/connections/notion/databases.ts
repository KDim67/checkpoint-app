/** which Notion database each workspace follows, and any columns picked for it on the Connections tab */

import { getDb, getSetting, readContextList, setSetting } from '../../db'
import { isNotionId } from '../../../shared/notion'

/** synced, so every computer follows the same databases */
export const NOTION_DATABASES_KEY = 'notion_databases'

export interface NotionChoice {
  /** the data source followed */
  source: string
  /** a column picked to mean done, or the date; found when absent */
  done?: string
  date?: string
}

export interface NotionFollow extends NotionChoice {
  slug: string
}

// column ids are short and url-encoded; anything else is not one
const isColumnId = (text: unknown): text is string => typeof text === 'string' && /^[A-Za-z0-9%_.~:;!*'()=@&+$,/?#[\]-]{1,80}$/.test(text)

export function readNotionChoices(): Record<string, NotionChoice> {
  const raw = getSetting<unknown>(NOTION_DATABASES_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, NotionChoice> = {}
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (typeof v.source !== 'string' || !isNotionId(v.source)) continue
    out[slug] = { source: v.source, ...(isColumnId(v.done) ? { done: v.done } : {}), ...(isColumnId(v.date) ? { date: v.date } : {}) }
  }
  return out
}

export function setNotionChoice(slug: string, choice: { source: string | null; done?: string | null; date?: string | null }): { ok: true } | { ok: false; reason: string } {
  if (choice.source !== null && !isNotionId(choice.source)) return { ok: false, reason: 'That isn\'t a Notion database.' }
  if ((choice.done != null && !isColumnId(choice.done)) || (choice.date != null && !isColumnId(choice.date))) return { ok: false, reason: 'That isn\'t a column of that database.' }
  const next = readNotionChoices()
  if (choice.source === null) delete next[slug]
  else next[slug] = { source: choice.source, ...(choice.done ? { done: choice.done } : {}), ...(choice.date ? { date: choice.date } : {}) }
  setSetting(NOTION_DATABASES_KEY, next)
  return { ok: true }
}

/** data source to workspace; a database two workspaces pick fills the first */
export function followedNotionSources(): Map<string, NotionFollow> {
  const choices = readNotionChoices()
  const out = new Map<string, NotionFollow>()
  for (const entry of readContextList(getDb()) ?? []) {
    const choice = choices[entry.slug]
    if (choice && !out.has(choice.source)) out.set(choice.source, { ...choice, slug: entry.slug })
  }
  return out
}
