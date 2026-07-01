import React, { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CustomCodeBlock } from '../log/LogEntry'
import { Sparkles, User, Mail, BookOpen, CheckCircle2, Layout, RefreshCw, Columns, ArrowRight, Pencil, Copy, Check, Trash2, FileText } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { withLock } from '../../lib/asyncMutex'
import { useToast } from '../ui/Toast'

interface ChatMessageProps {
  message: {
    role: 'system' | 'user' | 'assistant'
    content: string
    displayContent?: string
    mode?: string
    cheatsheets?: string[]
    timestamp?: number
    boardSnapshot?: {
      columns: any[]
      cards: any[]
    }
  }
  messageIndex?: number
  onResend?: (index: number) => void
  onRewrite?: (newContent: string, index: number) => void
  onRevert?: (index: number) => void
  onCopy?: (content: string, index: number) => void
  isCopied?: boolean
  isStreaming?: boolean
  hasRevertAction?: boolean
}

// Global execution & caching locks, prevent duplicate DB calls and React Strict Mode double-fires
const executedActionSignaturesSet = new Set<string>()
const createdItemsCacheMap = new Map<string, { item: any; tags: any[] }>()
const createdColsCacheMap = new Map<string, any>()

// Exported so AiStreamPanel can clear caches on new chat
export function clearActionCaches() {
  executedActionSignaturesSet.clear()
  createdItemsCacheMap.clear()
  createdColsCacheMap.clear()
}

// Colour resolution
// The AI sometimes writes colour names instead of hex codes. Resolve them.
const NAMED_COLORS: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
  cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', indigo: '#6366f1',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', pink: '#ec4899',
  rose: '#f43f5e', gray: '#6b7280', slate: '#64748b', white: '#f8fafc'
}
function resolveColor(val?: string): string {
  if (!val) return '#3b82f6'
  const v = val.trim()
  if (v.startsWith('#') || v.startsWith('rgb')) return v
  return NAMED_COLORS[v.toLowerCase()] ?? '#3b82f6'
}

// Type detectors
function looksLikeColumn(obj: any): boolean {
  return !!(
    obj.create_column || obj.column_name || obj.stage_name ||
    obj.wipLimit !== undefined || obj.wip_limit !== undefined ||
    (obj.colorMode && ['header', 'full', 'none'].includes(String(obj.colorMode).toLowerCase())) ||
    (obj.color_mode && ['header', 'full', 'none'].includes(String(obj.color_mode).toLowerCase()))
  )
}
function looksLikeCard(obj: any): boolean {
  return !!(obj.create_card || obj.create_task || obj.title || obj.card_name || obj.task_name || obj.card_title || obj.header)
}

// Single-block normalizers (used by CreateTaskActionBlock / CreateColumnActionBlock)

function normalizeCardJson(jsonString: string) {
  let parsed: any = null
  try { parsed = JSON.parse(jsonString.trim()) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  // Hard-reject anything that looks exclusively like a column
  if (looksLikeColumn(parsed) && !looksLikeCard(parsed)) return null

  // Unwrap wrapper keys
  const obj = parsed.create_card || parsed.create_task || parsed.card || parsed.task || parsed

  // Title from any common key
  const title =
    obj.title || obj.card_name || obj.task_name || obj.card_title || obj.header ||
    // Accept `name` as title only when the object also has body/description/status/priority
    (obj.name && (obj.body || obj.description || obj.status || obj.priority !== undefined || obj.tags)
      ? obj.name : null)

  if (!title || typeof title !== 'string') return null
  if (looksLikeColumn(obj)) return null   // e.g. { name: "Backlog", wipLimit: 5 }

  const body  = obj.body || obj.description || obj.details || obj.content || ''
  const status   = obj.status || obj.column || obj.stage || 'open'
  const priority = obj.priority ?? 2
  const tags     = Array.isArray(obj.tags) ? obj.tags : []

  return { raw: parsed, title: String(title).trim(), body: String(body).trim(), status, priority, tags }
}

function normalizeColumnJson(jsonString: string) {
  let parsed: any = null
  try { parsed = JSON.parse(jsonString.trim()) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  // Hard-reject anything that looks like a card
  if (looksLikeCard(parsed) && !looksLikeColumn(parsed)) return null

  const obj = parsed.create_column || parsed.column || parsed.stage || parsed

  const name = obj.name || obj.column_name || obj.title || obj.stage_name
  if (!name || typeof name !== 'string') return null

  const wipLimit  = obj.wipLimit ?? obj.wip_limit ?? null
  const colorMode = obj.colorMode ?? obj.color_mode ?? 'header'
  const color     = resolveColor(obj.color)

  return { raw: parsed, name: String(name).trim(), wipLimit, colorMode, color }
}

// Batch board parser, handles every format the AI might produce

function parseBatchBoardJson(jsonString: string) {
  let parsed: any = null
  try { parsed = JSON.parse(jsonString.trim()) } catch { return null }
  if (!parsed) return null

  const columns: any[] = []
  const cards:   any[] = []
  const seenCols  = new Set<string>()
  const seenCards = new Set<string>()

  function pushCol(obj: any) {
    if (!obj || typeof obj !== 'object') return
    const name = obj.name || obj.column_name || obj.title || obj.stage_name
    if (!name || typeof name !== 'string') return
    const key = name.trim().toLowerCase()
    if (seenCols.has(key)) return
    seenCols.add(key)
    columns.push({
      name:      name.trim(),
      wipLimit:  obj.wipLimit ?? obj.wip_limit ?? null,
      colorMode: obj.colorMode ?? obj.color_mode ?? 'header',
      color:     resolveColor(obj.color ?? (typeof obj.colorMode === 'string' && !['header', 'full', 'none'].includes(obj.colorMode) ? obj.colorMode : undefined))
    })
  }

  function pushCard(obj: any, defaultStatus = 'open') {
    if (!obj || typeof obj !== 'object') return
    const title =
      obj.title || obj.card_name || obj.task_name || obj.card_title || obj.header ||
      (obj.name && !looksLikeColumn(obj) ? obj.name : null)
    if (!title || typeof title !== 'string') return
    const key = title.trim().toLowerCase()
    if (seenCards.has(key)) return
    seenCards.add(key)
    cards.push({
      title:    title.trim(),
      body:     String(obj.body || obj.description || obj.details || obj.content || '').trim(),
      status:   String(obj.status || obj.column || obj.stage || defaultStatus),
      priority: obj.priority ?? 2,
      tags:     Array.isArray(obj.tags) ? obj.tags : []
    })
  }

  // Keys that contain leaf/metadata data, never recurse into them
  const SKIP_RECURSE = new Set(['tags', 'choices', 'steps', 'metadata', 'meta', 'options', 'extra', 'properties'])

  // Strategy 1 (most common): { columns: [...], cards: [...] }
  if (Array.isArray(parsed.columns) || Array.isArray(parsed.cards)) {
    for (const c of (parsed.columns || [])) pushCol(c)
    for (const c of (parsed.cards   || [])) pushCard(c)
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // Strategy 2: { stages: [...], tasks: [...] } aliases
  if (Array.isArray(parsed.stages) || Array.isArray(parsed.tasks) || Array.isArray(parsed.items)) {
    for (const c of (parsed.stages || [])) pushCol(c)
    for (const c of [...(parsed.tasks || []), ...(parsed.items || [])]) pushCard(c)
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // Strategy 3: root is an array of mixed column/card objects
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      if (looksLikeColumn(item) && !looksLikeCard(item)) pushCol(item)
      else if (looksLikeCard(item)) pushCard(item)
    }
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // Strategy 4: recursive walk for wrapped / nested formats
  function walk(node: any, currentStatus = 'open') {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, currentStatus)
      return
    }

    let localStatus = currentStatus

    // Column?
    if (node.create_column || node.column_name || node.stage_name ||
        node.wipLimit !== undefined || node.wip_limit !== undefined) {
      const obj = node.create_column || node.column || node.stage || node
      pushCol(obj)
      const colName = (obj.name || obj.column_name || obj.title || '').trim()
      if (colName) localStatus = colName
    }

    // Card (wrapped)?
    const cardWrap = node.create_card || node.create_task || node.card || node.task
    if (cardWrap && typeof cardWrap === 'object' && !Array.isArray(cardWrap)) {
      pushCard(cardWrap, localStatus)
    } else if (!looksLikeColumn(node) && looksLikeCard(node)) {
      pushCard(node, localStatus)
    }

    // Recurse into sub-objects, skipping wrapper keys already handled & leaf data
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

function BatchBoardActionBlock({ jsonString }: { jsonString: string }) {
  const activeContext = useAppStore(s => s.activeContext)
  const setView = useAppStore(s => s.setView)
  const [completedData, setCompletedData] = useState<{ columns: any[]; cards: any[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const batchData = parseBatchBoardJson(jsonString)
  const signature = batchData ? `batch::${activeContext || 'default'}::${batchData.columns.map(c => c.name).join(',')}_${batchData.cards.map(c => c.title).join(',')}` : ''

  useEffect(() => {
    let isMounted = true
    const processBatch = async () => {
      try {
        if (!batchData || !signature) return
        if (executedActionSignaturesSet.has(signature)) {
          if (isMounted) setCompletedData(batchData)
          return
        }
        executedActionSignaturesSet.add(signature)

        const validContext = activeContext || 'default'
        const key = `kanban_columns_${validContext}`

        // 1. Create Columns (locked: prevents a concurrent column writer, 
        //    e.g. the Kanban view's own "bootstrap default columns" path, or
        //    another action block in the same message, from reading the
        //    same stale column list and clobbering this write or creating a
        //    second column with the same name).
        const { createdCols, colsList } = await withLock(`kanban-cols:${validContext}`, async () => {
          const rawCols = await window.electronAPI.db.getSetting(key).catch(() => null)
          let colsList: any[] = []
          if (typeof rawCols === 'string') {
            try { colsList = JSON.parse(rawCols) } catch (e) { colsList = [] }
          } else if (Array.isArray(rawCols)) {
            colsList = rawCols
          }
          if (colsList.length === 0) {
            colsList = [
              { id: 'open', name: 'Backlog' },
              { id: 'in_progress', name: 'In Progress' },
              { id: 'in_review', name: 'In Review' },
              { id: 'done', name: 'Done' }
            ]
          }

          const createdCols: any[] = []
          for (const col of batchData.columns) {
            const existing = colsList.find((c: any) => c.name.toLowerCase() === col.name.toLowerCase())
            if (existing) {
              createdCols.push(existing)
            } else {
              const id = `col-${col.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`
              const newCol = { id, name: col.name, wipLimit: col.wipLimit, color: resolveColor(col.color), colorMode: col.colorMode ?? 'header' }
              colsList.push(newCol)
              createdCols.push(newCol)
            }
          }
          if (batchData.columns.length > 0) {
            await window.electronAPI.db.setSetting(key, JSON.stringify(colsList))
          }
          return { createdCols, colsList }
        })

        // 2. Create Cards (locked: prevents two concurrent creators from
        //    both seeing "no existing card with this title" and inserting
        //    duplicates, a classic check-then-act race).
        const createdCards = await withLock(`kanban-cards:${validContext}`, async () => {
          const existingItemsRes = await window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
          const existingCardsList = [...(existingItemsRes?.items || [])]
          const created: any[] = []

          for (const card of batchData.cards) {
            const existing = existingCardsList.find((ci: any) => ci.title.trim().toLowerCase() === card.title.trim().toLowerCase())
            if (existing) {
              created.push(existing)
              continue
            }

            // Fuzzy status → column matching
            const rawStatus = (card.status || '').trim().toLowerCase()
            let matchedCol =
              colsList.find((c: any) => c.id.toLowerCase() === rawStatus) ||
              colsList.find((c: any) => c.name.toLowerCase() === rawStatus) ||
              colsList.find((c: any) => c.name.toLowerCase().replace(/\s+/g, '_') === rawStatus) ||
              colsList.find((c: any) => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === rawStatus.replace(/[^a-z0-9]/g, '')) ||
              (rawStatus.includes('todo') || rawStatus.includes('backlog') || rawStatus.includes('open')
                ? (colsList.find((c: any) => c.id === 'open') || colsList[0])
                : rawStatus.includes('progress') || rawStatus.includes('doing')
                ? (colsList.find((c: any) => c.id === 'in_progress') || colsList[1] || colsList[0])
                : rawStatus.includes('review') || rawStatus.includes('qa') || rawStatus.includes('test')
                ? (colsList.find((c: any) => c.id === 'in_review') || colsList[2] || colsList[0])
                : rawStatus.includes('done') || rawStatus.includes('complete') || rawStatus.includes('finish')
                ? (colsList.find((c: any) => c.id === 'done') || colsList[colsList.length - 1] || colsList[0])
                : colsList[0])

            const finalStatus = matchedCol ? matchedCol.id : (colsList[0]?.id || 'open')

            const createdCard = await window.electronAPI.db.createItem({
              context: validContext, type: 'card',
              title: card.title, body: card.body,
              status: finalStatus, priority: card.priority
            }, [])
            // Keep the local list current so duplicate titles *within this
            // same batch* (e.g. the AI accidentally repeats a title) are
            // also caught, not just titles that already existed in the DB.
            existingCardsList.push(createdCard)
            created.push(createdCard)
          }

          return created
        })

        window.dispatchEvent(new CustomEvent('kanban-refresh'))
        window.dispatchEvent(new CustomEvent('item-updated'))

        if (isMounted) {
          setCompletedData({ columns: createdCols, cards: createdCards })
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || String(err))
      }
    }
    processBatch()
    return () => { isMounted = false }
  }, [jsonString, activeContext, signature])

  if (error) {
    return (
      <div style={{ padding: '8px 10px', color: 'var(--color-error)', fontSize: '11px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>⚠ Failed to update board: {error}</span>
        <button
          onClick={() => { executedActionSignaturesSet.delete(signature); setError(null) }}
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--color-error)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
        >Retry</button>
      </div>
    )
  }

  const displayData = completedData || batchData
  const colsCount = displayData?.columns.length || 0
  const cardsCount = displayData?.cards.length || 0

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(59, 130, 246, 0.08) 100%)',
        border: '1px solid rgba(168, 85, 247, 0.3)',
        borderRadius: 'var(--radius-md)',
        padding: '12px',
        margin: '10px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#c084fc', fontSize: '12px', fontWeight: 'bold' }}>
          <CheckCircle2 size={15} />
          <span>✓ POPULATED TO KANBAN BOARD</span>
        </div>
        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>
          {colsCount > 0 ? `${colsCount} Stage${colsCount > 1 ? 's' : ''}` : ''} {colsCount > 0 && cardsCount > 0 ? '•' : ''} {cardsCount > 0 ? `${cardsCount} Card${cardsCount > 1 ? 's' : ''}` : ''}
        </span>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--color-text)', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
        {displayData?.columns.map((c, i) => (
          <div key={`c-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#60a5fa' }}>
            <Columns size={12} />
            <span>Column: <strong>{c.name}</strong></span>
          </div>
        ))}
        {displayData?.cards.map((c, i) => (
          <div key={`k-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-text-muted)', paddingLeft: '4px' }}>
            <Layout size={11} />
            <span>Card: <strong>{c.title}</strong></span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
        <button
          onClick={() => setView('kanban')}
          style={{
            background: 'var(--color-secondary)',
            border: 'none',
            color: '#fff',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            transition: 'opacity 150ms ease'
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <Layout size={12} />
          <span>View on Kanban</span>
          <ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

function CreateTaskActionBlock({ jsonString }: { jsonString: string }) {
  const activeContext = useAppStore(s => s.activeContext)
  const selectItem = useAppStore(s => s.selectItem)
  const setView = useAppStore(s => s.setView)
  const [createdItem, setCreatedItem] = useState<any>(null)
  const [itemTags, setItemTags] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  const normalized = normalizeCardJson(jsonString)
  const title = normalized?.title || ''
  const signature = title ? `card::${activeContext || 'default'}::${title.toLowerCase()}` : ''

  const cached = signature ? createdItemsCacheMap.get(signature) : null
  const currentItem = createdItem || cached?.item
  const currentTags = itemTags.length > 0 ? itemTags : (cached?.tags || [])

  const previewData = normalized ? {
    title: normalized.title,
    body: normalized.body,
    status: normalized.status,
    priority: normalized.priority,
    tags: normalized.tags
  } : null

  const data = currentItem || previewData

  useEffect(() => {
    let isMounted = true
    const autoCreate = async () => {
      try {
        if (!normalized || !title || !signature) return

        if (cached) {
          if (isMounted) {
            setCreatedItem(cached.item)
            setItemTags(cached.tags)
          }
          return
        }

        if (executedActionSignaturesSet.has(signature)) {
          return
        }
        executedActionSignaturesSet.add(signature)

        const validContext = activeContext || 'default'

        const created = await withLock(`kanban-cards:${validContext}`, async () => {
          const existingItemsRes = await window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
          const existingCard = (existingItemsRes?.items || []).find((ci: any) => ci.title.trim().toLowerCase() === title.trim().toLowerCase())

          if (existingCard) {
            createdItemsCacheMap.set(signature, { item: existingCard, tags: [] })
            return { item: existingCard, tags: [], isNew: false }
          }

          const body = normalized.body || ''
          const priority = normalized.priority ?? 2

          // Resolve status to match existing board column IDs
          let finalStatus = 'open'
          const colKey = `kanban_columns_${validContext}`
          const colVal = await window.electronAPI.db.getSetting(colKey).catch(() => null)
          let cols: any[] = []
          if (colVal) {
            try { cols = JSON.parse(colVal as string) } catch {}
          }
          if (!cols || cols.length === 0) {
            cols = [
              { id: 'open', name: 'Backlog' },
              { id: 'in_progress', name: 'In Progress' },
              { id: 'in_review', name: 'In Review' },
              { id: 'done', name: 'Done' }
            ]
          }

          const rawStatus = (normalized.status || '').trim().toLowerCase()
          let matchedCol = cols.find(c => c.id.toLowerCase() === rawStatus)
          if (!matchedCol) {
            matchedCol = cols.find(c => c.name.toLowerCase() === rawStatus || c.name.toLowerCase().replace(/\s+/g, '_') === rawStatus || c.name.toLowerCase().replace(/\s+/g, '') === rawStatus.replace(/\s+/g, ''))
          }
          if (!matchedCol) {
            if (rawStatus.includes('todo') || rawStatus.includes('backlog') || rawStatus.includes('open')) {
              matchedCol = cols.find(c => c.id === 'open') || cols[0]
            } else if (rawStatus.includes('progress') || rawStatus.includes('doing') || rawStatus.includes('work')) {
              matchedCol = cols.find(c => c.id === 'in_progress') || cols[1] || cols[0]
            } else if (rawStatus.includes('review') || rawStatus.includes('qa') || rawStatus.includes('test')) {
              matchedCol = cols.find(c => c.id === 'in_review') || cols[2] || cols[0]
            } else if (rawStatus.includes('done') || rawStatus.includes('complete') || rawStatus.includes('finish')) {
              matchedCol = cols.find(c => c.id === 'done') || cols[cols.length - 1] || cols[0]
            }
          }
          finalStatus = matchedCol ? matchedCol.id : (cols[0]?.id || 'open')

          // Handle Tags if provided
          const tagIds: string[] = []
          const createdTagsList: any[] = []
          if (Array.isArray(normalized.tags) && normalized.tags.length > 0) {
            const existingTags = await window.electronAPI.db.getTags().catch(() => [])
            for (const t of normalized.tags) {
              const tagName = typeof t === 'string' ? t : t.name
              const tagColor = (typeof t === 'object' && t.color) ? t.color : '#3b82f6'
              let found = existingTags.find((et: any) => et.name.toLowerCase() === tagName.toLowerCase())
              if (!found) {
                try {
                  found = await window.electronAPI.db.createTag({ name: tagName, color: tagColor })
                } catch (err) {
                  console.warn('Failed to create tag:', err)
                }
              }
              if (found) {
                tagIds.push(found.id)
                createdTagsList.push(found)
              }
            }
          }

          const newItem = await window.electronAPI.db.createItem({
            context: validContext,
            type: 'card',
            title,
            body,
            status: finalStatus,
            priority
          }, tagIds)

          // Cache the result permanently in memory
          createdItemsCacheMap.set(signature, { item: newItem, tags: createdTagsList })

          return { item: newItem, tags: createdTagsList, isNew: true }
        })

        // Dispatch live update event to reload Kanban board instantly
        window.dispatchEvent(new CustomEvent('kanban-refresh'))
        window.dispatchEvent(new CustomEvent('item-updated'))

        if (isMounted) {
          setCreatedItem(created.item)
          setItemTags(created.tags)
        }
      } catch (e: any) {
        if (isMounted) setError(e.message || String(e))
      }
    }
    autoCreate()
    return () => { isMounted = false }
  }, [jsonString, activeContext, signature])

  if (error) {
    return (
      <div style={{ padding: '8px 10px', color: 'var(--color-error)', fontSize: '11px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>⚠ Failed to create card: {error}</span>
        <button
          onClick={() => { executedActionSignaturesSet.delete(signature); setError(null) }}
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--color-error)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
        >Retry</button>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', margin: '8px 0' }}>
        <div style={{ padding: '4px 0', color: 'var(--color-text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
          <span>Generating card block...</span>
        </div>
      </div>
    )
  }

  // Look up the human-readable column name for whatever status ID this card has
  const [colDisplayName, setColDisplayName] = React.useState<string>('')
  React.useEffect(() => {
    const lookup = async () => {
      try {
        const ctx = activeContext || 'default'
        const raw = await window.electronAPI.db.getSetting(`kanban_columns_${ctx}`).catch(() => null)
        const cols: any[] = raw ? JSON.parse(raw as string) : []
        const match = cols.find((c: any) =>
          c.id === data.status || c.name?.toLowerCase() === String(data.status).toLowerCase()
        )
        if (match) setColDisplayName(match.name)
        else {
          // Friendly label for default column IDs
          const labels: Record<string, string> = {
            open: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done'
          }
          setColDisplayName(labels[data.status] || String(data.status))
        }
      } catch { setColDisplayName(String(data.status)) }
    }
    lookup()
  }, [data.status, activeContext])

  const priorityColor = data.priority === 3 ? '#ef4444' : data.priority === 2 ? '#eab308' : '#94a3b8'
  const priorityLabel = data.priority === 3 ? 'High' : data.priority === 2 ? 'Medium' : 'Low'

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, var(--color-surface-2) 0%, var(--color-surface-1) 100%)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        margin: '12px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Top Header Badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#60a5fa', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.02em' }}>
          <CheckCircle2 size={14} style={{ color: '#3b82f6' }} />
          <span>ADDED TO KANBAN BOARD</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 'bold',
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#60a5fa',
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}
          >
            {colDisplayName || data.status}
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 'bold',
              background: `${priorityColor}22`,
              color: priorityColor,
              border: `1px solid ${priorityColor}44`
            }}
          >
            {priorityLabel} Priority
          </span>
        </div>
      </div>

      {/* Card Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text-base)', lineHeight: 1.4 }}>
          {data.title}
        </div>
        {data.body && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {data.body}
          </div>
        )}
      </div>

      {/* Tags Chips */}
      {((currentTags && currentTags.length > 0) || (data.tags && data.tags.length > 0)) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
          {(currentTags.length > 0 ? currentTags : data.tags).map((t: any, idx: number) => {
            const tagName = typeof t === 'string' ? t : t.name
            const tagColor = (typeof t === 'object' && t.color) ? t.color : '#3b82f6'
            return (
              <span
                key={idx}
                style={{
                  fontSize: '9px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  background: `${tagColor}22`,
                  color: tagColor,
                  border: `1px solid ${tagColor}44`
                }}
              >
                #{tagName}
              </span>
            )
          })}
        </div>
      )}

      {/* View Action Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
        <button
          onClick={() => {
            if (currentItem) selectItem(currentItem.id)
            setView('kanban')
          }}
          style={{
            background: 'var(--color-secondary)',
            border: 'none',
            color: 'var(--color-text-inverted)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            transition: 'opacity 150ms ease'
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <Layout size={12} />
          <span>View on Kanban</span>
          <ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

function CreateColumnActionBlock({ jsonString }: { jsonString: string }) {
  const activeContext = useAppStore(s => s.activeContext)
  const setView = useAppStore(s => s.setView)
  const [createdCol, setCreatedCol] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const normalized = normalizeColumnJson(jsonString)
  const name = normalized?.name || ''
  const signature = name ? `col::${activeContext || 'default'}::${name.toLowerCase()}` : ''

  const cachedCol = signature ? createdColsCacheMap.get(signature) : null
  const colData = createdCol || cachedCol || (normalized ? { name: normalized.name, color: normalized.color, wipLimit: normalized.wipLimit } : null)

  useEffect(() => {
    let isMounted = true
    const autoCreateCol = async () => {
      try {
        if (!normalized || !name || !signature) return

        if (cachedCol) {
          if (isMounted) setCreatedCol(cachedCol)
          return
        }

        if (executedActionSignaturesSet.has(signature)) {
          return
        }
        executedActionSignaturesSet.add(signature)

        const wipLimit = normalized.wipLimit
        const color = normalized.color
        const colorMode = normalized.colorMode
        const context = activeContext || 'default'
        const key = `kanban_columns_${context}`

        const newCol = await withLock(`kanban-cols:${context}`, async () => {
          const rawCols = await window.electronAPI.db.getSetting(key).catch(() => null)
          let colsList: any[] = []
          if (typeof rawCols === 'string') {
            try { colsList = JSON.parse(rawCols) } catch (e) { colsList = [] }
          } else if (Array.isArray(rawCols)) {
            colsList = rawCols
          }

          if (colsList.length === 0) {
            colsList = [
              { id: 'open', name: 'To Do' },
              { id: 'in_progress', name: 'In Progress' },
              { id: 'in_review', name: 'In Review' },
              { id: 'done', name: 'Done' }
            ]
          }

          // Prevent duplicate column names
          const existing = colsList.find(c => c.name.toLowerCase() === name.toLowerCase())
          if (existing) {
            createdColsCacheMap.set(signature, existing)
            return existing
          }

          const id = `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
          const created = { id, name, wipLimit, color, colorMode }
          const updatedCols = [...colsList, created]

          await window.electronAPI.db.setSetting(key, JSON.stringify(updatedCols))
          createdColsCacheMap.set(signature, created)
          return created
        })

        // Dispatch live update event to reload Kanban board instantly
        window.dispatchEvent(new CustomEvent('kanban-refresh'))

        if (isMounted) setCreatedCol(newCol)
      } catch (e: any) {
        if (isMounted) setError(e.message || String(e))
      }
    }
    autoCreateCol()
    return () => { isMounted = false }
  }, [jsonString, activeContext, signature])

  if (error) {
    return (
      <div style={{ padding: '8px 10px', color: 'var(--color-error)', fontSize: '11px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>⚠ Failed to create column: {error}</span>
        <button
          onClick={() => { executedActionSignaturesSet.delete(signature); setError(null) }}
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--color-error)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
        >Retry</button>
      </div>
    )
  }

  if (!colData) {
    return (
      <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', margin: '8px 0' }}>
        <div style={{ padding: '4px 0', color: 'var(--color-text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} />
          <span>Generating column block...</span>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, var(--color-surface-2) 0%, var(--color-surface-1) 100%)',
        border: `1px solid ${colData.color || '#3b82f6'}66`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        margin: '12px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: colData.color || '#3b82f6', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.02em' }}>
          <Columns size={14} />
          <span>CREATED STAGE COLUMN</span>
        </div>
        {colData.wipLimit !== null && (
          <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold', background: 'rgba(255,255,255,0.1)', color: 'var(--color-text-muted)' }}>
            WIP Limit: {colData.wipLimit}
          </span>
        )}
      </div>

      <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: colData.color, boxShadow: `0 0 10px ${colData.color}aa` }} />
        <span>{colData.name}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '8px' }}>
        <button
          onClick={() => setView('kanban')}
          style={{
            background: 'var(--color-surface-offset)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--color-text-base)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px'
          }}
        >
          <Layout size={12} />
          <span>Go to Board</span>
          <ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

function CreatePlanActionBlock({ jsonString }: { jsonString: string }) {
  const activeContext = useAppStore(s => s.activeContext)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()
  const [exportedCount, setExportedCount] = useState<number | null>(null)

  let parsed: any = null
  try { parsed = JSON.parse(jsonString.trim()) } catch (e) {}

  if (!parsed) return <pre>{jsonString}</pre>

  const steps = Array.isArray(parsed.steps) ? parsed.steps : []

  const handleBatchExport = async () => {
    let count = 0
    const context = activeContext || 'default'
    for (const step of steps) {
      try {
        await window.electronAPI.db.createItem({
          context,
          type: 'card',
          title: step.title || 'Plan Task',
          body: step.details || '',
          status: 'open',
          priority: 2
        }, [])
        count++
      } catch (e) { console.warn('Failed to export plan step:', e) }
    }
    setExportedCount(count)
    window.dispatchEvent(new CustomEvent('kanban-refresh'))
  }

  const handleExportMarkdown = async () => {
    let md = `# ${parsed.title || 'Implementation Plan'}\n\n`
    if (parsed.overview) {
      md += `## Overview\n\n${parsed.overview}\n\n`
    }
    md += `## Proposed Steps\n\n`
    for (const step of steps) {
      md += `- [ ] **${step.title}**\n`
      if (step.details) {
        md += `  ${step.details}\n`
      }
      md += `\n`
    }

    const success = await window.electronAPI.app.saveFile('implementation_plan.md', md)
    if (success) {
      toast('Implementation plan saved successfully!', { type: 'success' })
    }
  }

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95))', border: '1px solid rgba(148, 163, 184, 0.2)', borderRadius: 'var(--radius-md)', padding: '12px 14px', margin: '12px 0', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 'bold', color: '#38bdf8' }}>
          <Sparkles size={14} />
          <span>Implementation Plan</span>
        </div>
        {exportedCount !== null && (
          <span style={{ fontSize: '10px', background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold' }}>
            ✓ {exportedCount} Cards Added to Kanban
          </span>
        )}
      </div>
      <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#f8fafc', marginBottom: '4px' }}>{parsed.title}</div>
      {parsed.overview && <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>{parsed.overview}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        {steps.map((s: any, idx: number) => (
          <div key={idx} style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', fontSize: '11px' }}>
            <div style={{ fontWeight: 'bold', color: '#e2e8f0' }}>{s.title}</div>
            {s.details && <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{s.details}</div>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button
          onClick={handleExportMarkdown}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#fff',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 12px',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
        >
          <FileText size={12} style={{ color: '#38bdf8' }} />
          <span>Save as Markdown (.md)</span>
        </button>

        <button onClick={handleBatchExport} disabled={exportedCount !== null} style={{ background: exportedCount !== null ? 'rgba(255,255,255,0.1)' : '#0284c7', border: 'none', color: '#fff', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: '11px', fontWeight: 'bold', cursor: exportedCount !== null ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Layout size={12} />
          <span>{exportedCount !== null ? 'Tasks Exported' : 'Export All Steps to Kanban'}</span>
        </button>
      </div>
    </div>
  )
}

function CreateDialogueTreeActionBlock({ jsonString }: { jsonString: string }) {
  const setView = useAppStore(s => s.setView)
  const [loaded, setLoaded] = useState(false)

  let parsed: any = null
  try { parsed = JSON.parse(jsonString.trim()) } catch (e) {}

  if (!parsed) return <pre>{jsonString}</pre>

  const handleLoadTree = () => {
    window.dispatchEvent(new CustomEvent('ai-load-dialogue-tree', { detail: parsed }))
    setLoaded(true)
    setView('gamedev')
  }

  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : []

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(24, 24, 27, 0.95), rgba(9, 9, 11, 0.98))', border: '1px solid rgba(161, 161, 170, 0.2)', borderRadius: 'var(--radius-md)', padding: '12px 14px', margin: '12px 0', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 'bold', color: '#a855f7' }}>
          <Sparkles size={14} />
          <span>Branching Dialogue & Quest Flow ({nodes.length} Nodes)</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px', maxHeight: '160px', overflowY: 'auto' }}>
        {nodes.map((n: any, idx: number) => (
          <div key={idx} style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', fontSize: '11px' }}>
            <div style={{ fontWeight: 'bold', color: '#e4e4e7' }}><span style={{ color: '#c084fc' }}>{n.speaker || 'NPC'}:</span> "{n.text}"</div>
            {Array.isArray(n.choices) && n.choices.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                {n.choices.map((c: any, ci: number) => (
                  <span key={ci} style={{ fontSize: '9px', background: 'rgba(168, 85, 247, 0.15)', color: '#d8b4fe', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.3)' }}>➜ {c.text}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleLoadTree} style={{ background: loaded ? 'rgba(255,255,255,0.1)' : '#9333ea', border: 'none', color: '#fff', borderRadius: 'var(--radius-sm)', padding: '5px 12px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Layout size={12} />
          <span>{loaded ? 'Loaded in Game Dev' : 'Load into Dialogue Quest Builder'}</span>
          <ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

export default function ChatMessage({ message, messageIndex, onResend, onRewrite, onRevert, onCopy, isCopied, isStreaming, hasRevertAction }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const [showTimestamp, setShowTimestamp] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(message.displayContent || message.content)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEditText(message.displayContent || message.content)
  }, [message.content, message.displayContent])

  const handleSaveEdit = () => {
    if (editText.trim() && onRewrite) {
      onRewrite(editText.trim(), messageIndex ?? 0)
      setIsEditing(false)
    }
  }

  const relativeTime = (ts?: number) => {
    if (!ts) return ''
    const diff = Date.now() - ts
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return new Date(ts).toLocaleDateString()
  }

  if (message.role === 'system') return null // Do not render system instructions in bubbles

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        width: '100%',
        boxSizing: 'border-box'
      }}
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => setShowTimestamp(false)}
    >
      {/* Role Avatar */}
      <div
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: isUser ? 'var(--color-primary)' : 'var(--color-secondary-muted)',
          color: isUser ? 'var(--color-text-inverted)' : 'var(--color-secondary)',
          border: isUser ? 'none' : '1px solid var(--color-secondary)'
        }}
      >
        {isUser ? <User size={12} /> : <Sparkles size={12} fill="currentColor" />}
      </div>

      {/* Bubble Content */}
      <div
        style={{
          background: isUser ? 'var(--color-surface-offset)' : 'var(--color-surface-2)',
          border: isUser ? '1px solid var(--color-surface-offset)' : '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          maxWidth: '88%',
          fontSize: 'var(--text-xs)',
          lineHeight: 1.6,
          color: 'var(--color-text-base)',
          boxSizing: 'border-box',
          overflow: 'hidden',
          boxShadow: isUser ? 'none' : '0 2px 8px rgba(0, 0, 0, 0.15)',
          position: 'relative'
        }}
        className={isUser ? undefined : 'markdown-body'}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: (message.mode || (message.cheatsheets && message.cheatsheets.length > 0)) ? '6px' : '0px' }}>
          {message.mode === 'email_draft' && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'var(--color-secondary-muted)',
                border: '1px solid var(--color-secondary)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 'bold',
                color: 'var(--color-secondary)'
              }}
            >
              <Mail size={12} />
              <span>Draft Email Request</span>
            </div>
          )}

          {message.cheatsheets && message.cheatsheets.map((csName, idx) => (
            <div
              key={idx}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 'bold',
                color: '#60a5fa'
              }}
            >
              <BookOpen size={12} />
              <span>{csName}</span>
            </div>
          ))}
        </div>

        {isUser ? (
          <div>
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: '220px' }}>
                <textarea
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '60px',
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-secondary)',
                    color: 'var(--color-text-base)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 'var(--space-2)',
                    fontSize: '11px',
                    outline: 'none',
                    fontFamily: 'var(--font-sans)',
                    resize: 'vertical'
                  }}
                />
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setIsEditing(false)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-surface-offset)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-muted)',
                      padding: '2px 8px',
                      fontSize: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    style={{
                      background: 'var(--color-secondary)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-inverted)',
                      padding: '2px 8px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Save & Submit
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.displayContent || message.content}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '6px', paddingTop: '4px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              {/* Timestamp */}
              <span style={{
                fontSize: '9px', color: 'var(--color-text-faint)',
                opacity: showTimestamp ? 1 : 0, transition: 'opacity 150ms ease'
              }}>
                {relativeTime(message.timestamp)}
              </span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {onRewrite && !isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--color-text-muted)', fontSize: '10px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px', borderRadius: '4px'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                    title="Edit prompt and resubmit"
                  >
                    <Pencil size={11} />
                    <span>Rewrite</span>
                  </button>
                )}
                {onResend && !isEditing && (
                  <button
                    onClick={() => onResend(messageIndex ?? 0)}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--color-secondary)', fontSize: '10px', fontWeight: 'bold',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px', borderRadius: '4px'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    title="Resend this prompt turn"
                  >
                    <RefreshCw size={11} />
                    <span>Resend</span>
                  </button>
                )}
                {hasRevertAction && onRevert && !isEditing && (
                  <button
                    onClick={() => {
                      onRevert(messageIndex ?? 0)
                    }}
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: 'var(--color-error)', fontSize: '10px', fontWeight: 'bold',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 4px', borderRadius: '4px'
                    }}
                    title="Undo board changes and rollback history"
                  >
                    <Trash2 size={11} />
                    <span>Revert</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-([^\s]+)/.exec(className || '')
                  const lang = match ? match[1] : ''
                  const rawContent = String(children)

                  // Step 1: Explicit language tag wins, use the rich single-block UIs
                  if (lang === 'create_card' || lang === 'create_task' || lang.includes('create_card') || lang.includes('create_task')) {
                    const normCard = normalizeCardJson(rawContent)
                    if (normCard) return <CreateTaskActionBlock jsonString={rawContent} />
                  }
                  if (lang === 'create_column' || lang.includes('create_column')) {
                    const normCol = normalizeColumnJson(rawContent)
                    if (normCol) return <CreateColumnActionBlock jsonString={rawContent} />
                  }
                  if (lang === 'create_plan' || lang.includes('create_plan')) {
                    return <CreatePlanActionBlock jsonString={rawContent} />
                  }
                  if (lang === 'create_dialogue_tree' || lang.includes('create_dialogue_tree')) {
                    return <CreateDialogueTreeActionBlock jsonString={rawContent} />
                  }

                  // Step 2: Generic JSON, try batch (handles all AI output formats)
                  if (lang === 'json' || lang === 'create_batch' || lang === 'batch' || lang === '') {
                    const batch = parseBatchBoardJson(rawContent)
                    if (batch && (batch.columns.length > 0 || batch.cards.length > 0)) {
                      return <BatchBoardActionBlock jsonString={rawContent} />
                    }
                  }

                  // Step 3: Unlabelled fenced block, try all parsers as a last resort
                  if (!lang || lang === 'json') {
                    const normCard = normalizeCardJson(rawContent)
                    if (normCard) return <CreateTaskActionBlock jsonString={rawContent} />
                    const normCol = normalizeColumnJson(rawContent)
                    if (normCol) return <CreateColumnActionBlock jsonString={rawContent} />
                  }

                  // Fallback: plain code block
                  const isBlock = className?.includes('language-') || String(children).includes('\n')
                  return isBlock ? (
                    <CustomCodeBlock
                      language={match ? match[1] : undefined}
                      value={String(children).replace(/\n$/, '')}
                    />
                  ) : (
                    <code
                      className={className}
                      {...props}
                      style={{
                        background: 'var(--color-surface-2)',
                        padding: '2px 4px',
                        borderRadius: 'var(--radius-sm)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.9em',
                        color: 'var(--color-secondary)'
                      }}
                    >
                      {children}
                    </code>
                  )
                }
              }}
            >
              {message.content}
            </ReactMarkdown>

            {/* Blinking cursor at end of streaming message */}
            {isStreaming && (
              <span className="ai-streaming-cursor" />
            )}

            {/* Bottom row: timestamp + copy button */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginTop: '6px', paddingTop: '4px',
              borderTop: (showTimestamp || isCopied) ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
              transition: 'border-color 150ms ease'
            }}>
              <span style={{
                fontSize: '9px', color: 'var(--color-text-faint)',
                opacity: showTimestamp ? 1 : 0, transition: 'opacity 150ms ease'
              }}>
                {relativeTime(message.timestamp)}
              </span>
              {onCopy && messageIndex !== undefined && (
                <button
                  onClick={() => onCopy(message.displayContent || message.content, messageIndex)}
                  style={{
                    background: 'transparent', border: 'none',
                    color: isCopied ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '2px 4px', borderRadius: '4px', fontSize: '10px',
                    opacity: (showTimestamp || isCopied) ? 1 : 0, transition: 'opacity 150ms ease'
                  }}
                  title="Copy response"
                >
                  {isCopied ? <Check size={11} /> : <Copy size={11} />}
                  <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}