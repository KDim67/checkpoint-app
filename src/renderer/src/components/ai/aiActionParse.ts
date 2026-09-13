// model output is malformed often, so readers return null instead of throwing

import type { BatchBoard, BatchCard, BatchColumn, JsonObject, ParsedCardJson, ParsedColumnJson } from './aiActionTypes'
import { asArray, asObject, str, toItemPriority } from './aiActionTypes'

// the AI sometimes writes colour names instead of hex
const NAMED_COLORS: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  rose: '#f43f5e', gray: '#6b7280', slate: '#64748b', white: '#f8fafc'
}
export function resolveColor(val?: unknown): string {
  if (typeof val !== 'string' || !val) return '#3b82f6'
  const v = val.trim()
  if (v.startsWith('#') || v.startsWith('rgb')) return v
  return NAMED_COLORS[v.toLowerCase()] ?? '#3b82f6'
}

// unknown not any, raw model output must be narrowed
export function faultTolerantParseJSON(jsonStr: string): unknown {
  const clean = jsonStr.trim()
  try {
    return JSON.parse(clean)
  } catch {
    try {
      const repaired = clean
        .replace(/(["\d])\s*[\r\n]+\s*(?="[^"]+"\s*:)/g, '$1,')
        .replace(/(true|false|null)\s*[\r\n]+\s*(?="[^"]+"\s*:)/gi, '$1,')
        .replace(/\}\s*[\r\n]+\s*\{/g, '},{')
        .replace(/\]\s*[\r\n]+\s*\{/g, '],{')
        .replace(/,\s*([\]}])/g, '$1')
        .replace(/\/\/.*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')

      return JSON.parse(repaired)
    } catch {
      return null
    }
  }
}

function looksLikeColumn(obj: JsonObject): boolean {
  return !!(
    obj.create_column || obj.column_name || obj.stage_name ||
    obj.wipLimit !== undefined || obj.wip_limit !== undefined ||
    (obj.colorMode && ['header', 'full', 'none'].includes(String(obj.colorMode).toLowerCase())) ||
    (obj.color_mode && ['header', 'full', 'none'].includes(String(obj.color_mode).toLowerCase()))
  )
}
function looksLikeCard(obj: JsonObject): boolean {
  return !!(obj.create_card || obj.create_task || obj.title || obj.card_name || obj.task_name || obj.card_title || obj.header)
}

export function normalizeCardJson(jsonString: string): ParsedCardJson | null {
  const parsed = asObject(faultTolerantParseJSON(jsonString))
  if (!parsed) return null

  // reject anything that's only a column
  if (looksLikeColumn(parsed) && !looksLikeCard(parsed)) return null

  // a wrapper key holding a non-object yields no fields
  const wrapped = parsed.create_card || parsed.create_task || parsed.card || parsed.task
  const obj: JsonObject = wrapped ? (asObject(wrapped) ?? {}) : parsed

  const title =
    obj.title || obj.card_name || obj.task_name || obj.card_title || obj.header ||
    // name counts as title only alongside card fields
    (obj.name && (obj.body || obj.description || obj.status || obj.priority !== undefined || obj.tags)
      ? obj.name : null)

  if (!title || typeof title !== 'string') return null
  if (looksLikeColumn(obj)) return null   // e.g. { name: "Backlog", wipLimit: 5 }

  // coerced, a "3" priority used to reach the DB raw
  return {
    title: title.trim(),
    body: str(obj.body || obj.description || obj.details || obj.content).trim(),
    status: str(obj.status || obj.column || obj.stage || 'open'),
    priority: toItemPriority(obj.priority),
    tags: asArray(obj.tags)
  }
}

export function normalizeColumnJson(jsonString: string): ParsedColumnJson | null {
  const parsed = asObject(faultTolerantParseJSON(jsonString))
  if (!parsed) return null

  // reject anything that's only a card
  if (looksLikeCard(parsed) && !looksLikeColumn(parsed)) return null

  const wrapped = parsed.create_column || parsed.column || parsed.stage
  const obj: JsonObject = wrapped ? (asObject(wrapped) ?? {}) : parsed

  const name = obj.name || obj.column_name || obj.title || obj.stage_name
  if (!name || typeof name !== 'string') return null

  return {
    name: name.trim(),
    wipLimit: toWipLimit(obj.wipLimit ?? obj.wip_limit),
    colorMode: str(obj.colorMode ?? obj.color_mode ?? 'header'),
    color: resolveColor(obj.color)
  }
}

/** "5" is a formatting slip, not a missing limit */
function toWipLimit(raw: unknown): number | null {
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// handles every format the AI produces

export function parseBatchBoardJson(jsonString: string): BatchBoard | null {
  const parsed = faultTolerantParseJSON(jsonString)
  if (!parsed) return null

  const columns: BatchColumn[] = []
  const cards:   BatchCard[]   = []
  const seenCols  = new Set<string>()
  const seenCards = new Set<string>()

  function pushCol(raw: unknown) {
    const obj = asObject(raw)
    if (!obj) return
    const name = obj.name || obj.column_name || obj.title || obj.stage_name
    if (!name || typeof name !== 'string') return
    const key = name.trim().toLowerCase()
    if (seenCols.has(key)) return
    seenCols.add(key)
    columns.push({
      name:      name.trim(),
      wipLimit:  toWipLimit(obj.wipLimit ?? obj.wip_limit),
      colorMode: str(obj.colorMode ?? obj.color_mode ?? 'header'),
      color:     resolveColor(obj.color ?? (typeof obj.colorMode === 'string' && !['header', 'full', 'none'].includes(obj.colorMode) ? obj.colorMode : undefined))
    })
  }

  function pushCard(raw: unknown, defaultStatus = 'open') {
    const obj = asObject(raw)
    if (!obj) return
    const title =
      obj.title || obj.card_name || obj.task_name || obj.card_title || obj.header ||
      (obj.name && !looksLikeColumn(obj) ? obj.name : null)
    if (!title || typeof title !== 'string') return
    const key = title.trim().toLowerCase()
    if (seenCards.has(key)) return
    seenCards.add(key)
    cards.push({
      title:    title.trim(),
      body:     str(obj.body || obj.description || obj.details || obj.content).trim(),
      status:   str(obj.status || obj.column || obj.stage || defaultStatus),
      priority: toItemPriority(obj.priority),
      tags:     asArray(obj.tags)
    })
  }

  // leaf/metadata keys, never recurse
  const SKIP_RECURSE = new Set(['tags', 'choices', 'steps', 'metadata', 'meta', 'options', 'extra', 'properties'])

  const root = asObject(parsed)

  // 1: { columns, cards }, most common
  if (root && (Array.isArray(root.columns) || Array.isArray(root.cards))) {
    for (const c of asArray(root.columns)) pushCol(c)
    for (const c of asArray(root.cards))   pushCard(c)
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // 2: stages/tasks/items aliases
  if (root && (Array.isArray(root.stages) || Array.isArray(root.tasks) || Array.isArray(root.items))) {
    for (const c of asArray(root.stages)) pushCol(c)
    for (const c of [...asArray(root.tasks), ...asArray(root.items)]) pushCard(c)
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // 3: a mixed array
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const o = asObject(item)
      if (!o) continue
      if (looksLikeColumn(o) && !looksLikeCard(o)) pushCol(o)
      else if (looksLikeCard(o)) pushCard(o)
    }
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // 4: recursive walk for wrapped formats
  function walk(rawNode: unknown, currentStatus = 'open') {
    if (Array.isArray(rawNode)) {
      for (const item of rawNode) walk(item, currentStatus)
      return
    }
    const node = asObject(rawNode)
    if (!node) return

    let localStatus = currentStatus

    if (node.create_column || node.column_name || node.stage_name ||
        node.wipLimit !== undefined || node.wip_limit !== undefined) {
      const wrapped = node.create_column || node.column || node.stage
      const obj: JsonObject = wrapped ? (asObject(wrapped) ?? {}) : node
      pushCol(obj)
      const colName = str(obj.name || obj.column_name || obj.title).trim()
      if (colName) localStatus = colName
    }

    const cardWrap = asObject(node.create_card || node.create_task || node.card || node.task)
    if (cardWrap) {
      pushCard(cardWrap, localStatus)
    } else if (!looksLikeColumn(node) && looksLikeCard(node)) {
      pushCard(node, localStatus)
    }

    // skip wrapper keys already handled and leaf data
    for (const key of Object.keys(node)) {
      if (SKIP_RECURSE.has(key)) continue
      if (['create_column', 'create_card', 'card', 'column', 'task', 'stage'].includes(key)) continue
      const val = node[key]
      if (val && typeof val === 'object') walk(val, localStatus)
    }
  }

  walk(parsed)
  if (columns.length === 0 && cards.length === 0) return null
  return { columns, cards }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** skips code; each title linked once per prose stretch to avoid link spam */
export function linkifyCardTitles(content: string, entries: Array<{ title: string; id: string }>): string {
  if (!entries.length || !content) return content
  const segments = content.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]
    if (seg.startsWith('```') || seg.startsWith('`')) continue
    let out = seg
    for (const { title, id } of entries) {
      if (!out.toLowerCase().includes(title.toLowerCase())) continue
      const re = new RegExp(`(^|[^\\w\\[])(${escapeRegExp(title)})(?=$|[^\\w\\]])`, 'i')
      out = out.replace(re, (_m, pre: string, matched: string) => `${pre}[${matched}](#card:${id})`)
    }
    segments[s] = out
  }
  return segments.join('')
}
