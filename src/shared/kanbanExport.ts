import type { BoardConfig } from './boardModel'
import type { Item, ItemPriority } from './types'

export interface KanbanExportCard {
  title: string
  body?: string
  status?: string // column ID
  priority?: ItemPriority
  position?: number
  due_at?: number | null
  metadata?: string
  tags?: { name: string; color?: string }[]
}

export interface KanbanJsonExport {
  checkpointType: 'kanban'
  version: 1
  workspace?: string
  exportedAt: string
  board: {
    config?: BoardConfig
    cards: KanbanExportCard[]
  }
}

export function normalizePriority(p: unknown): ItemPriority {
  if (typeof p === 'number' && [0, 1, 2, 3].includes(p)) return p as ItemPriority
  if (typeof p === 'string') {
    const s = p.toLowerCase().trim()
    if (s === 'high' || s === 'urgent') return 3
    if (s === 'medium' || s === 'med') return 2
    if (s === 'low') return 1
  }
  return 0
}

export function buildKanbanJsonExport(
  config: BoardConfig,
  cards: Item[],
  workspace?: string
): KanbanJsonExport {
  const exportCards: KanbanExportCard[] = cards
    .filter(c => c.status !== 'archived')
    .map(c => ({
      title: c.title,
      body: c.body || '',
      status: c.status,
      priority: c.priority,
      position: c.position,
      due_at: c.due_at,
      metadata: c.metadata || '{}',
      tags: c.tags?.map(t => ({ name: t.name, color: t.color })) ?? []
    }))

  return {
    checkpointType: 'kanban',
    version: 1,
    workspace,
    exportedAt: new Date().toISOString(),
    board: {
      config,
      cards: exportCards
    }
  }
}

export function parseKanbanJsonExport(raw: unknown): {
  config?: BoardConfig
  cards: KanbanExportCard[]
  workspace?: string
} | null {
  let source = raw
  if (typeof raw === 'string') {
    try { source = JSON.parse(raw) } catch { return null }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null

  const o = source as Record<string, unknown>
  const board = (o.board && typeof o.board === 'object' && !Array.isArray(o.board))
    ? (o.board as Record<string, unknown>)
    : o

  const rawCards = Array.isArray(board.cards)
    ? board.cards
    : Array.isArray(o.cards)
      ? o.cards
      : Array.isArray(source)
        ? source
        : []

  const cards: KanbanExportCard[] = rawCards
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
    .map(c => {
      const title = typeof c.title === 'string' ? c.title.trim() : ''
      const body = typeof c.body === 'string' ? c.body : ''
      const status = typeof c.status === 'string' ? c.status : undefined
      const priority = normalizePriority(c.priority)
      const position = typeof c.position === 'number' && Number.isFinite(c.position) ? c.position : undefined
      const due_at = typeof c.due_at === 'number' ? c.due_at : null
      const metadata = typeof c.metadata === 'string'
        ? c.metadata
        : (c.metadata && typeof c.metadata === 'object' ? JSON.stringify(c.metadata) : '{}')
      const tags = Array.isArray(c.tags)
        ? c.tags.map((t: unknown) => {
            if (typeof t === 'string') return { name: t.trim() }
            if (t && typeof t === 'object') {
              const to = t as Record<string, unknown>
              return { name: String(to.name ?? '').trim(), color: typeof to.color === 'string' ? to.color : undefined }
            }
            return { name: '' }
          }).filter(t => t.name.length > 0)
        : []

      return { title, body, status, priority, position, due_at, metadata, tags }
    })
    .filter(c => c.title.length > 0)

  const config = (board.config && typeof board.config === 'object')
    ? (board.config as BoardConfig)
    : undefined

  const workspace = typeof o.workspace === 'string' ? o.workspace : undefined

  return { config, cards, workspace }
}
