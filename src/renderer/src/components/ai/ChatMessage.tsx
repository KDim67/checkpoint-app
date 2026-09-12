import React, { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from '../ui/CodeBlock'
import { Sparkles, User, Mail, BookOpen, CheckCircle2, Layout, RefreshCw, Columns, ArrowRight, Pencil, Copy, Check, Trash2, FileText, FileDown, Brain, X } from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { withLock } from '../../lib/asyncMutex'
import {
  boardConfigLockKey,
  readBoardConfigUnlocked,
  writeBoardConfigUnlocked,
  loadBoardConfig,
  type ColumnConfig
} from '../../lib/boardConfig'
import { applyConfigOps, normalizeConfigUpdate, type ConfigOperation } from '../../lib/boardConfigOps'
import { useToast } from '../ui/Toast'
import { normalizeUpdate } from './boardEnrich'
import type { UpdateOperation } from './boardEnrich'
import type {
  AiDialogueChoice, AiDialogueNode, AiPlanStep,
  BatchBoard, BatchCard, BatchColumn, JsonObject,
  ParsedCardJson, ParsedColumnJson
} from './aiActionTypes'
import { asArray, asObject, str, tagColorOf, tagNameOf, toColorMode, toItemPriority } from './aiActionTypes'
import type { Item, Tag } from '@shared/types'
import { AI_DIALOGUE_EVENT } from '../gamedev/useDialogueTool'
import { tagResolver } from '../../data/tags'

interface ChatMessageProps {
  message: {
    role: 'system' | 'user' | 'assistant'
    content: string
    displayContent?: string
    thinking?: string
    mode?: string
    cheatsheets?: string[]
    /** Attached note titles (knowledge docs pulled from the Notes feature). */
    notes?: string[]
    /** Attached workspace file relative paths. */
    files?: string[]
    /** Attached images as data URLs (vision-capable models). */
    images?: string[]
    timestamp?: number
    boardSnapshot?: {
      columns: ColumnConfig[]
      cards: Item[]
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
  /** The panel's global streaming flag. Compared by React.memo so committed
   *  messages re-render (fresh handler closures) when streaming toggles. */
  actionsLocked?: boolean
}

// Global execution & caching locks. Prevent duplicate DB calls and React Strict Mode double-fires
const executedActionSignaturesSet = new Set<string>()
const createdItemsCacheMap = new Map<string, { item: Item; tags: Tag[] }>()
const createdColsCacheMap = new Map<string, ColumnConfig>()
// Real outcome of each board-edit execution, so a remount replays the TRUTH
// (what was actually applied / skipped / not found) instead of the request.
interface UpdateOutcome {
  applied: string[]
  notFound: string[]
  failed: string[]
  noops: number
  /** Inverse patches (in application order) enabling one-click undo. */
  inverse?: Array<{ id: string; patch: Partial<Item> }>
  undone?: boolean
}
const executedUpdateOutcomesMap = new Map<string, UpdateOutcome>()

// Exported so AiStreamPanel can clear caches on new chat
export function clearActionCaches() {
  executedActionSignaturesSet.clear()
  createdItemsCacheMap.clear()
  createdColsCacheMap.clear()
  executedUpdateOutcomesMap.clear()
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
function resolveColor(val?: unknown): string {
  if (typeof val !== 'string' || !val) return '#3b82f6'
  const v = val.trim()
  if (v.startsWith('#') || v.startsWith('rgb')) return v
  return NAMED_COLORS[v.toLowerCase()] ?? '#3b82f6'
}

// Returns `unknown`, not `any`: this is raw model output and every reader below
// has to narrow it before touching a field.
function faultTolerantParseJSON(jsonStr: string): unknown {
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

/** Message text from a thrown value: `catch` binds `unknown`, and an IPC
 *  rejection is not always an Error. */
function errorText(err: unknown): string {
  const message = asObject(err)?.message
  return typeof message === 'string' && message ? message : String(err)
}

// Type detectors
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

// Single-block normalizers (used by CreateTaskActionBlock / CreateColumnActionBlock)

function normalizeCardJson(jsonString: string): ParsedCardJson | null {
  const parsed = asObject(faultTolerantParseJSON(jsonString))
  if (!parsed) return null

  // Hard-reject anything that looks exclusively like a column
  if (looksLikeColumn(parsed) && !looksLikeCard(parsed)) return null

  // Unwrap wrapper keys. A wrapper key holding a non-object yields no fields,
  // which is what indexing into a bare string used to produce.
  const wrapped = parsed.create_card || parsed.create_task || parsed.card || parsed.task
  const obj: JsonObject = wrapped ? (asObject(wrapped) ?? {}) : parsed

  // Title from any common key
  const title =
    obj.title || obj.card_name || obj.task_name || obj.card_title || obj.header ||
    // Accept `name` as title only when the object also has body/description/status/priority
    (obj.name && (obj.body || obj.description || obj.status || obj.priority !== undefined || obj.tags)
      ? obj.name : null)

  if (!title || typeof title !== 'string') return null
  if (looksLikeColumn(obj)) return null   // e.g. { name: "Backlog", wipLimit: 5 }

  // Coerced here rather than left raw: a small model writing "3" for priority or
  // a number for status used to flow straight into the DB write untouched.
  return {
    title: title.trim(),
    body: str(obj.body || obj.description || obj.details || obj.content).trim(),
    status: str(obj.status || obj.column || obj.stage || 'open'),
    priority: toItemPriority(obj.priority),
    tags: asArray(obj.tags)
  }
}

function normalizeColumnJson(jsonString: string): ParsedColumnJson | null {
  const parsed = asObject(faultTolerantParseJSON(jsonString))
  if (!parsed) return null

  // Hard-reject anything that looks like a card
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

/** A WIP limit the model wrote as "5" is a formatting slip, not a missing limit. */
function toWipLimit(raw: unknown): number | null {
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// Batch board parser. Handles every format the AI might produce

function parseBatchBoardJson(jsonString: string): BatchBoard | null {
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

  // Keys that contain leaf/metadata data, never recurse into them
  const SKIP_RECURSE = new Set(['tags', 'choices', 'steps', 'metadata', 'meta', 'options', 'extra', 'properties'])

  const root = asObject(parsed)

  // Strategy 1 (most common): { columns: [...], cards: [...] }
  if (root && (Array.isArray(root.columns) || Array.isArray(root.cards))) {
    for (const c of asArray(root.columns)) pushCol(c)
    for (const c of asArray(root.cards))   pushCard(c)
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // Strategy 2: { stages: [...], tasks: [...] } aliases
  if (root && (Array.isArray(root.stages) || Array.isArray(root.tasks) || Array.isArray(root.items))) {
    for (const c of asArray(root.stages)) pushCol(c)
    for (const c of [...asArray(root.tasks), ...asArray(root.items)]) pushCard(c)
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // Strategy 3: root is an array of mixed column/card objects
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const o = asObject(item)
      if (!o) continue
      if (looksLikeColumn(o) && !looksLikeCard(o)) pushCol(o)
      else if (looksLikeCard(o)) pushCard(o)
    }
    if (columns.length > 0 || cards.length > 0) return { columns, cards }
  }

  // Strategy 4: recursive walk for wrapped / nested formats
  function walk(rawNode: unknown, currentStatus = 'open') {
    if (Array.isArray(rawNode)) {
      for (const item of rawNode) walk(item, currentStatus)
      return
    }
    const node = asObject(rawNode)
    if (!node) return

    let localStatus = currentStatus

    // Column?
    if (node.create_column || node.column_name || node.stage_name ||
        node.wipLimit !== undefined || node.wip_limit !== undefined) {
      const wrapped = node.create_column || node.column || node.stage
      const obj: JsonObject = wrapped ? (asObject(wrapped) ?? {}) : node
      pushCol(obj)
      const colName = str(obj.name || obj.column_name || obj.title).trim()
      if (colName) localStatus = colName
    }

    // Card (wrapped)?
    const cardWrap = asObject(node.create_card || node.create_task || node.card || node.task)
    if (cardWrap) {
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

// The confirmation row shows either the PROPOSED columns (before execution) or
// the ones actually written to the setting. This is the overlap it renders.
type ShownColumn = { name: string; color?: string }

function BatchBoardActionBlock({ jsonString }: { jsonString: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const [completedData, setCompletedData] = useState<{ columns: ShownColumn[]; cards: BatchCard[]; skippedCards?: number; reusedCols?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const batchData = parseBatchBoardJson(jsonString)
  const signature = batchData ? `batch::${activeWorkspace || 'default'}::${batchData.columns.map(c => c.name).join(',')}_${batchData.cards.map(c => c.title).join(',')}` : ''

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

        const validContext = activeWorkspace || 'default'

        // 1. Create Columns (locked: prevents a concurrent column writer,
        //    e.g. the Kanban view's own "bootstrap default columns" path, or
        //    another action block in the same message. From reading the
        //    same stale column list and clobbering this write or creating a
        //    second column with the same name).
        const { createdCols, colsList, reusedCols } = await withLock(boardConfigLockKey(validContext), async () => {
          // Reads and writes the unified board document rather than the raw
          // column key. The unlocked primitives are correct here precisely
          // because this block already holds the lock for the whole
          // read-decide-write sequence.
          const config = await readBoardConfigUnlocked(validContext)
          const colsList: ColumnConfig[] = [...config.columns]

          // Track only columns we actually create. Reused ones aren't "added".
          const createdCols: ColumnConfig[] = []
          let reusedCols = 0
          for (const col of batchData.columns) {
            const existing = colsList.find(c => c.name.toLowerCase() === col.name.toLowerCase())
            if (existing) { reusedCols++; continue }
            const id = `col-${col.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`
            const newCol = { id, name: col.name, wipLimit: col.wipLimit, color: resolveColor(col.color), colorMode: toColorMode(col.colorMode) }
            colsList.push(newCol)
            createdCols.push(newCol)
          }
          if (createdCols.length > 0) {
            await writeBoardConfigUnlocked(validContext, { ...config, columns: colsList })
          }
          return { createdCols, colsList, reusedCols }
        })

        // 2. Create Cards (locked: prevents two concurrent creators from
        //    both seeing "no existing card with this title" and inserting
        //    duplicates. A classic check-then-act race).
        const { newCards, skippedCards } = await withLock(`kanban-cards:${validContext}`, async () => {
          const existingItemsRes = await window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
          // Exclude archived cards: the archive bin is invisible to the AI, so a
          // title that only exists in the archive must NOT block a fresh create.
          const existingCardsList = [...(existingItemsRes?.items || [])].filter(ci => ci.status !== 'archived')
          const newCards: BatchCard[] = []
          let skippedCards = 0

          // Load tags once and reuse/extend as we create cards, so colored tags
          // from the AI are actually applied in the batch path (previously dropped).
          const resolve = await tagResolver()
          const resolveTagIds = async (tags: unknown[]): Promise<string[]> => {
            if (!Array.isArray(tags)) return []
            const found = await resolve(
              tags
                .map(t => ({ name: tagNameOf(t) ?? '', color: tagColorOf(t, '#3b82f6') }))
                .filter(t => t.name)
            )
            return found.map(tag => tag.id)
          }

          // Position base: explicit ascending positions keep the batch in order
          // AND fix a real bug. Omitting position let the IPC validator default
          // it to 0, pinning every AI card above user cards and making them
          // impossible to reorder (midpoint of two 0-positions is still 0).
          const posBase = Date.now()

          for (const card of batchData.cards) {
            const existing = existingCardsList.find(ci => ci.title.trim().toLowerCase() === card.title.trim().toLowerCase())
            if (existing) {
              // Already on the board (or a duplicate within this batch). Don't recreate.
              skippedCards++
              continue
            }

            // Fuzzy status → column matching
            const rawStatus = (card.status || '').trim().toLowerCase()
            const matchedCol =
              colsList.find(c => c.id.toLowerCase() === rawStatus) ||
              colsList.find(c => c.name.toLowerCase() === rawStatus) ||
              colsList.find(c => c.name.toLowerCase().replace(/\s+/g, '_') === rawStatus) ||
              colsList.find(c => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === rawStatus.replace(/[^a-z0-9]/g, '')) ||
              (rawStatus.includes('todo') || rawStatus.includes('backlog') || rawStatus.includes('open')
                ? (colsList.find(c => c.id === 'open') || colsList[0])
                : rawStatus.includes('progress') || rawStatus.includes('doing')
                ? (colsList.find(c => c.id === 'in_progress') || colsList[1] || colsList[0])
                : rawStatus.includes('review') || rawStatus.includes('qa') || rawStatus.includes('test')
                ? (colsList.find(c => c.id === 'in_review') || colsList[2] || colsList[0])
                : rawStatus.includes('done') || rawStatus.includes('complete') || rawStatus.includes('finish')
                ? (colsList.find(c => c.id === 'done') || colsList[colsList.length - 1] || colsList[0])
                : colsList[0])

            const finalStatus = matchedCol ? matchedCol.id : (colsList[0]?.id || 'open')

            const tagIds = await resolveTagIds(card.tags)
            // Optional AI-provided deadline (ISO date string, validated upstream)
            const dueMs = card.due && !Number.isNaN(Date.parse(card.due)) ? Date.parse(card.due) : null
            const createdCard = await window.electronAPI.db.createItem({
              context: validContext, type: 'card',
              title: card.title, body: card.body,
              status: finalStatus, priority: card.priority,
              position: posBase + newCards.length * 10,
              due_at: dueMs, metadata: '{}'
            }, tagIds)
            // Keep the local list current so duplicate titles *within this
            // same batch* (e.g. the AI accidentally repeats a title) are
            // also caught, not just titles that already existed in the DB.
            existingCardsList.push(createdCard)
            // Store the original proposal object so the confirmation can show
            // its tags/priority/colors (the DB item doesn't carry those).
            newCards.push(card)
          }

          return { newCards, skippedCards }
        })

        window.dispatchEvent(new CustomEvent('kanban-refresh'))
        window.dispatchEvent(new CustomEvent('item-updated'))

        if (isMounted) {
          setCompletedData({ columns: createdCols, cards: newCards, skippedCards, reusedCols })
        }
      } catch (err) {
        if (isMounted) setError(errorText(err))
      }
    }
    processBatch()
    return () => { isMounted = false }
  }, [jsonString, activeWorkspace, signature])

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

  // Before execution: show the proposal (optimistic). After execution: show what
  // was ACTUALLY created, so the counts/rows never overstate what hit the board.
  const applied = !!completedData
  const showCols: ShownColumn[] = completedData ? completedData.columns : (batchData?.columns || [])
  const showCards: BatchCard[] = completedData ? completedData.cards : (batchData?.cards || [])
  const colsCount = showCols.length
  const cardsCount = showCards.length
  const skipped = completedData?.skippedCards || 0
  const reused = completedData?.reusedCols || 0
  const nothingNew = applied && colsCount === 0 && cardsCount === 0

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-accent-ai-soft)', fontSize: '12px', fontWeight: 'bold', minWidth: 0 }}>
          <CheckCircle2 size={15} style={{ flexShrink: 0, opacity: applied ? 1 : 0.45 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {!applied ? 'Adding to board…' : nothingNew ? 'Already up to date' : 'Added to board'}
          </span>
        </div>
        {!nothingNew && (
          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {[colsCount > 0 ? `${colsCount} col${colsCount > 1 ? 's' : ''}` : '', cardsCount > 0 ? `${cardsCount} card${cardsCount > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'no change'}
          </span>
        )}
      </div>

      {applied && (skipped > 0 || reused > 0) && (
        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginTop: '-2px' }}>
          {[skipped > 0 ? `${skipped} card${skipped > 1 ? 's' : ''} already on the board` : '', reused > 0 ? `${reused} existing column${reused > 1 ? 's' : ''} reused` : ''].filter(Boolean).join(' · ')}
        </div>
      )}

      {nothingNew ? (
        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Everything requested was already on the board. Nothing new to add.
        </div>
      ) : (
      <div style={{ fontSize: '11px', color: 'var(--color-text)', display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '200px', overflowY: 'auto', overflowX: 'hidden' }}>
        {showCols.map((c, i) => (
          <div key={`c-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: resolveColor(c.color), flexShrink: 0 }} />
            <span style={{ color: 'var(--color-primary-soft)', flexShrink: 0, fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: '0.03em' }}>Column</span>
            <strong style={{ color: '#93c5fd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{c.name}</strong>
          </div>
        ))}
        {showCards.map((c, i) => {
          const pc = c.priority === 3 ? '#ef4444' : c.priority === 2 ? '#eab308' : '#3b82f6'
          const tags = asArray(c.tags)
          return (
            <div key={`k-${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', paddingLeft: '2px', minWidth: 0 }}>
              <span title={`Priority ${c.priority}`} style={{ width: 6, height: 6, borderRadius: '50%', background: pc, flexShrink: 0, marginTop: '5px' }} />
              <div style={{ minWidth: 0, flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 6px' }}>
                <strong style={{ color: 'var(--color-text-base)', wordBreak: 'break-word' }}>{c.title}</strong>
                {tags.slice(0, 3).map((t, ti) => {
                  const tn = tagNameOf(t)
                  if (!tn) return null
                  const tcol = tagColorOf(t, '#64748b')
                  return (
                    <span key={ti} style={{ fontSize: '8px', color: tcol, border: `1px solid ${tcol}55`, background: `${tcol}18`, borderRadius: '6px', padding: '0 5px', whiteSpace: 'nowrap' }}>
                      {tn.replace(/^#/, '')}
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
        <button
          onClick={() => setView('kanban')}
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

// Board edit executor (```json:update_board)
// Applies move / set_priority / retitle / update_body / archive operations to
// EXISTING cards. Honest reporting: lists exactly what was applied, what was a
// no-op, and which targets couldn't be found on the board.
// The one field that distinguishes two edits of the same op on the same card.
// Only move/set_priority/retitle carry one; the rest collapse to '', which is
// what the old `toColumn || priority || newTitle || ''` chain produced.
function opSignatureValue(o: UpdateOperation): string | number {
  if (o.op === 'move') return o.toColumn
  if (o.op === 'set_priority') return o.priority
  if (o.op === 'retitle') return o.newTitle
  return ''
}

function UpdateBoardActionBlock({ jsonString, dedupeKey }: { jsonString: string; dedupeKey?: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const [result, setResult] = useState<(UpdateOutcome & { replayed?: boolean }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)

  const parsed = faultTolerantParseJSON(jsonString)
  const normalized = parsed ? normalizeUpdate(parsed) : null
  const operations = normalized?.operations || []
  // dedupeKey (the message timestamp) scopes idempotency to THIS message:
  // remounts of the same message replay, but asking for the same edit again
  // in a NEW message must execute again. Repeating a request is the most
  // natural user reaction when something didn't work.
  const signature = operations.length
    ? `update::${activeWorkspace || 'default'}::${dedupeKey || ''}::${operations.map(o => `${o.op}:${o.target}:${opSignatureValue(o)}`).join('|')}`
    : ''

  useEffect(() => {
    let isMounted = true
    const run = async () => {
      try {
        if (operations.length === 0 || !signature) return
        if (executedActionSignaturesSet.has(signature)) {
          // Already executed (e.g. reloaded saved chat / remount). Replay the
          // REAL recorded outcome, never a fabricated "all applied" summary.
          const recorded = executedUpdateOutcomesMap.get(signature)
          if (isMounted) {
            setResult(recorded
              ? { ...recorded, replayed: true }
              : { applied: [], notFound: [], failed: [], noops: 0, replayed: true })
          }
          return
        }
        executedActionSignaturesSet.add(signature)

        const validContext = activeWorkspace || 'default'

        const outcome = await withLock(`kanban-cards:${validContext}`, async () => {
          const [tasksRes, cardsRes] = await Promise.all([
            window.electronAPI.db.getItems(validContext, 'task', 1, 1000).catch(() => ({ items: [] })),
            window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
          ])
          // Kept separate on purpose: the Kanban board renders ONLY 'card'
          // items, so board edits must prefer cards. A Backlog task with the
          // same title must never shadow the visible card (that "moved"
          // something invisible and left the board looking untouched).
          const cardItems = (cardsRes?.items || []).filter(i => i.status !== 'archived')
          const taskItems = (tasksRes?.items || []).filter(i => i.status !== 'archived')

          // Unified board document, read unlocked because this block already
          // holds the board lock. The legacy key it used to read stopped being
          // written when configuration was unified, so column moves resolved
          // against a frozen snapshot of the board.
          const { columns: colsList } = await readBoardConfigUnlocked(validContext)

          const resolveCol = (nameOrId: string): ColumnConfig | null => {
            const q = (nameOrId || '').trim().toLowerCase()
            if (!q) return null
            return (
              colsList.find(c => c.id.toLowerCase() === q) ||
              colsList.find(c => c.name.toLowerCase() === q) ||
              colsList.find(c => c.name.toLowerCase().replace(/\s+/g, '_') === q) ||
              (q.includes('done') || q.includes('complete') ? colsList.find(c => c.id === 'done') : undefined) ||
              (q.includes('progress') || q.includes('doing') ? colsList.find(c => c.id === 'in_progress') : undefined) ||
              (q.includes('review') || q.includes('test') || q.includes('qa') ? colsList.find(c => c.id === 'in_review') : undefined) ||
              (q.includes('backlog') || q.includes('todo') || q.includes('open') ? colsList.find(c => c.id === 'open') : undefined) ||
              null
            )
          }

          // Exact title match first; fall back to a UNIQUE prefix/containment
          // match (card title contains the query) so a slightly-shortened title
          // still resolves. The reverse direction (query contains title) is
          // deliberately NOT allowed. It let short junk titles hijack edits.
          const findIn = (list: Item[], q: string): Item | undefined => {
            const exact = list.find(i => i.title.trim().toLowerCase() === q)
            if (exact) return exact
            if (q.length < 4) return undefined
            const loose = list.filter(i => i.title.trim().toLowerCase().includes(q))
            return loose.length === 1 ? loose[0] : undefined
          }
          // Cards always win over tasks; moves are card-only (tasks aren't on the board).
          const findCard = (title: string, cardsOnly: boolean): Item | undefined => {
            const q = title.trim().toLowerCase()
            return findIn(cardItems, q) ?? (cardsOnly ? undefined : findIn(taskItems, q))
          }

          // Small models sometimes put the COLUMN in "target" ("move In Review
          // to in_review"). Catch that explicitly so the report tells the truth
          // instead of hijacking whatever loosely matches.
          const isColumnName = (title: string): boolean => {
            const q = title.trim().toLowerCase()
            return colsList.some(c => c.id.toLowerCase() === q || c.name.toLowerCase() === q)
          }

          const applied: string[] = []
          const notFound: string[] = []
          const failed: string[] = []
          const inverse: Array<{ id: string; patch: Partial<Item> }> = []
          let noops = 0

          for (const op of operations) {
            const cardsOnly = op.op === 'move'
            const item = findCard(op.target, cardsOnly)
            if (!item) {
              if (isColumnName(op.target)) {
                notFound.push(`"${op.target}" is a column, not a card: specify which card to ${op.op === 'move' ? 'move' : 'edit'}`)
              } else if (cardsOnly && findCard(op.target, false)) {
                notFound.push(`"${op.target}" is a Backlog task, not a board card, only cards appear in Kanban columns`)
              } else {
                notFound.push(op.target)
              }
              continue
            }
            // Even with a loose match: never edit a card when the stated target
            // is actually a column name. That's a confused instruction.
            if (isColumnName(op.target) && item.title.trim().toLowerCase() !== op.target.trim().toLowerCase()) {
              notFound.push(`"${op.target}" is a column, not a card: specify which card to ${op.op === 'move' ? 'move' : 'edit'}`)
              continue
            }

            // One failing operation must never abort the rest of the batch.
            // Report it honestly and keep going.
            try {
              if (op.op === 'move') {
                const col = resolveCol(op.toColumn || '')
                if (!col) { notFound.push(`column "${op.toColumn}" (for "${op.target}")`); continue }
                if (item.status === col.id) { noops++; continue }
                await window.electronAPI.db.updateItem(item.id, { status: col.id })
                inverse.push({ id: item.id, patch: { status: item.status } })
                applied.push(`Moved "${item.title}" → ${col.name}`)
                item.status = col.id
              } else if (op.op === 'set_priority') {
                if (item.priority === op.priority) { noops++; continue }
                await window.electronAPI.db.updateItem(item.id, { priority: op.priority })
                inverse.push({ id: item.id, patch: { priority: item.priority } })
                applied.push(`"${item.title}" priority → ${op.priority === 3 ? 'High' : op.priority === 2 ? 'Medium' : 'Low'}`)
                item.priority = op.priority
              } else if (op.op === 'retitle') {
                if (item.title.trim() === (op.newTitle || '').trim()) { noops++; continue }
                await window.electronAPI.db.updateItem(item.id, { title: op.newTitle })
                inverse.push({ id: item.id, patch: { title: item.title } })
                applied.push(`Renamed "${item.title}" → "${op.newTitle}"`)
                item.title = op.newTitle
              } else if (op.op === 'update_body') {
                await window.electronAPI.db.updateItem(item.id, { body: op.newBody })
                inverse.push({ id: item.id, patch: { body: item.body || '' } })
                applied.push(`Updated description of "${item.title}"`)
              } else if (op.op === 'set_due_date') {
                const dueMs = op.due ? Date.parse(op.due) : null
                if (op.due && Number.isNaN(dueMs)) { failed.push(`set due date "${item.title}": unparseable date "${op.due}"`); continue }
                if ((item.due_at ?? null) === dueMs) { noops++; continue }
                await window.electronAPI.db.updateItem(item.id, { due_at: dueMs })
                inverse.push({ id: item.id, patch: { due_at: item.due_at ?? null } })
                applied.push(dueMs
                  ? `"${item.title}" due → ${new Date(dueMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`
                  : `Cleared due date of "${item.title}"`)
                item.due_at = dueMs
              } else if (op.op === 'archive') {
                await window.electronAPI.db.updateItem(item.id, { status: 'archived' })
                inverse.push({ id: item.id, patch: { status: item.status } })
                applied.push(`Archived "${item.title}"`)
                // Remove from whichever list holds it so later ops can't target it
                for (const list of [cardItems, taskItems]) {
                  const idx = list.indexOf(item)
                  if (idx >= 0) list.splice(idx, 1)
                }
              }
            } catch (opErr) {
              const reason = errorText(opErr)
                .replace(/^Error invoking remote method '[^']*':\s*/i, '')
                .replace(/^Error:\s*/i, '')
              failed.push(`${op.op.replace('_', ' ')} "${item.title}", ${reason}`)
            }
          }

          return { applied, notFound, failed, noops, inverse }
        })

        // Record the truth for future remounts BEFORE any state updates.
        // A replay must show what actually happened, not what was requested.
        executedUpdateOutcomesMap.set(signature, outcome)

        window.dispatchEvent(new CustomEvent('kanban-refresh'))
        window.dispatchEvent(new CustomEvent('item-updated'))
        if (isMounted) setResult(outcome)
      } catch (err) {
        // A crashed run must not fake "previously applied" on remount.
        // Release the signature so a retry (or remount) re-executes honestly.
        executedActionSignaturesSet.delete(signature)
        if (isMounted) setError(errorText(err))
      }
    }
    run()
    return () => { isMounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jsonString, activeWorkspace, signature])

  // One-click rollback: replay the recorded inverse patches in reverse order.
  const handleUndo = async () => {
    if (!result?.inverse?.length || undoing || result.undone) return
    setUndoing(true)
    try {
      for (const inv of [...result.inverse].reverse()) {
        await window.electronAPI.db.updateItem(inv.id, inv.patch).catch(() => {})
      }
      window.dispatchEvent(new CustomEvent('kanban-refresh'))
      window.dispatchEvent(new CustomEvent('item-updated'))
      const next = { ...result, undone: true }
      setResult(next)
      executedUpdateOutcomesMap.set(signature, next) // survives remounts
    } finally {
      setUndoing(false)
    }
  }

  if (!normalized) return <CodeBlock language="json" value={jsonString.trim()} />

  if (error) {
    return (
      <div style={{ padding: '8px 10px', color: 'var(--color-error)', fontSize: '11px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', margin: '8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>⚠ Failed to edit board: {error}</span>
        <button
          onClick={() => { executedActionSignaturesSet.delete(signature); setError(null) }}
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--color-error)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}
        >Retry</button>
      </div>
    )
  }

  const appliedList = result?.applied || []
  const notFound = result?.notFound || []
  const failedList = result?.failed || []
  const noops = result?.noops || 0
  const done = !!result
  const nothing = done && appliedList.length === 0

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(20, 184, 166, 0.12) 0%, rgba(59, 130, 246, 0.08) 100%)',
        border: '1px solid rgba(20, 184, 166, 0.35)',
        borderRadius: 'var(--radius-md)',
        padding: '12px',
        margin: '10px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#2dd4bf', fontSize: '12px', fontWeight: 'bold', minWidth: 0 }}>
          <RefreshCw size={14} style={{ flexShrink: 0, opacity: done ? 1 : 0.5 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {!done ? 'Editing board…'
              : result?.undone ? 'Edits undone'
              : result?.replayed ? 'Board edits (earlier run)'
              : failedList.length > 0 && appliedList.length === 0 ? 'Board edits failed'
              : failedList.length > 0 ? 'Board partially updated'
              : nothing ? 'No changes applied'
              : 'Board updated'}
          </span>
        </div>
        {done && appliedList.length > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {appliedList.length} change{appliedList.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {done && (
        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
          {appliedList.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', color: 'var(--color-text-base)' }}>
              <CheckCircle2 size={11} style={{ color: '#2dd4bf', flexShrink: 0, marginTop: '2px' }} />
              <span style={{ wordBreak: 'break-word' }}>{d}</span>
            </div>
          ))}
          {failedList.length > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--color-error)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {failedList.map((t, i) => (
                <span key={i}>✕ Failed: {t}</span>
              ))}
            </div>
          )}
          {noops > 0 && (
            <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>
              {noops} operation{noops > 1 ? 's were' : ' was'} already in the requested state.
            </div>
          )}
          {notFound.length > 0 && (
            <div style={{ fontSize: '10px', color: '#f59e0b', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {notFound.map((t, i) => (
                <span key={i}>⚠ Not found on the board: {t}</span>
              ))}
            </div>
          )}
          {result?.replayed && appliedList.length === 0 && notFound.length === 0 && failedList.length === 0 && (
            <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
              This edit ran in an earlier session. No record of applied changes is available.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '2px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
        {!!result?.inverse?.length && !result.undone && (
          <button
            onClick={handleUndo}
            disabled={undoing}
            title="Restore every edited card to its previous state"
            style={{
              background: 'transparent', border: '1px solid rgba(245, 158, 11, 0.5)', color: '#f59e0b',
              borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: '11px',
              fontWeight: 'bold', cursor: undoing ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '5px', opacity: undoing ? 0.6 : 1
            }}
          >
            <RefreshCw size={11} style={undoing ? { animation: 'spin 1s linear infinite' } : undefined} />
            <span>{undoing ? 'Undoing…' : 'Undo these edits'}</span>
          </button>
        )}
        <button
          onClick={() => setView('kanban')}
          style={{
            background: 'var(--color-secondary)', border: 'none', color: 'var(--color-text-inverted)',
            borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: '11px',
            fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px'
          }}
        >
          <Layout size={12} />
          <span>View on Kanban</span>
          <ArrowRight size={11} />
        </button>
      </div>
    </div>
  )
}

/** Persisted outcome of one configure_board block, so remounts replay the truth. */
interface ConfigOutcome {
  summary: string[]
  skipped: string[]
  inverse: ConfigOperation[]
  /** Cards relocated by a delete, with the status they held before. */
  movedCards: { id: string; status: string }[]
  undone?: boolean
}
const executedConfigOutcomesMap = new Map<string, ConfigOutcome>()

/**
 * Applies the assistant's board-configuration changes.
 *
 * Auto-applies like the card blocks do, but every change carries its inverse,
 * so a wrong call is one click from being reverted rather than something the
 * user has to unpick by hand.
 */
function ConfigureBoardActionBlock({ jsonString, dedupeKey }: { jsonString: string; dedupeKey?: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const [outcome, setOutcome] = useState<ConfigOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undoing, setUndoing] = useState(false)

  const parsed = faultTolerantParseJSON(jsonString)
  const normalized = parsed ? normalizeConfigUpdate(parsed) : null
  const operations = normalized?.operations ?? []
  const context = activeWorkspace || 'default'
  const signature = operations.length
    ? `config::${context}::${dedupeKey || ''}::${operations.map(o => `${o.op}:${o.target ?? o.name ?? ''}`).join('|')}`
    : ''

  useEffect(() => {
    if (!signature || operations.length === 0) return

    const cached = executedConfigOutcomesMap.get(signature)
    if (cached) { setOutcome(cached); return }
    if (executedActionSignaturesSet.has(signature)) return
    executedActionSignaturesSet.add(signature)

    let alive = true
    const apply = async (): Promise<void> => {
      try {
        // The whole read-decide-write runs under the shared board lock, so a
        // concurrent column write from the board or another block cannot land
        // between the read and the write and lose one side's changes.
        const result = await withLock(boardConfigLockKey(context), async () => {
          const current = await readBoardConfigUnlocked(context)
          const applied = applyConfigOps(current, operations)

          // Deleting a column strands its cards under a status no column
          // claims. They follow to the first surviving column, exactly as the
          // board's own delete does, and their prior status is recorded so
          // undo can put them back.
          const movedCards: { id: string; status: string }[] = []
          if (applied.cardMoves.length > 0) {
            const page = await window.electronAPI.db.getItems(context, 'card', 1, 1000)
            for (const move of applied.cardMoves) {
              const affected = page.items.filter(i => i.status === move.fromColumn)
              if (affected.length === 0) continue
              movedCards.push(...affected.map(i => ({ id: i.id, status: move.fromColumn })))
              await window.electronAPI.db.bulkUpdateItems({
                ids: affected.map(i => i.id),
                patch: { status: move.toColumn }
              })
            }
          }

          await writeBoardConfigUnlocked(context, applied.next)
          return { summary: applied.summary, skipped: applied.skipped, inverse: applied.inverse, movedCards }
        })

        window.dispatchEvent(new CustomEvent('kanban-refresh'))
        if (result.movedCards.length > 0) window.dispatchEvent(new CustomEvent('item-updated'))
        executedConfigOutcomesMap.set(signature, result)
        if (alive) setOutcome(result)
      } catch (err) {
        if (alive) setError((err as Error).message || String(err))
      }
    }
    apply()
    return () => { alive = false }
  }, [signature, context])

  const handleUndo = async (): Promise<void> => {
    if (!outcome || undoing || outcome.undone || outcome.inverse.length === 0) return
    setUndoing(true)
    try {
      await withLock(boardConfigLockKey(context), async () => {
        const current = await readBoardConfigUnlocked(context)
        // The inverse is already ordered newest-first by applyConfigOps.
        const reverted = applyConfigOps(current, outcome.inverse)
        await writeBoardConfigUnlocked(context, reverted.next)
      })
      // Cards go back to the column they came from, now that it exists again.
      for (const card of outcome.movedCards) {
        await window.electronAPI.db.updateItem(card.id, { status: card.status }).catch(() => {})
      }
      window.dispatchEvent(new CustomEvent('kanban-refresh'))
      if (outcome.movedCards.length > 0) window.dispatchEvent(new CustomEvent('item-updated'))
      const next = { ...outcome, undone: true }
      executedConfigOutcomesMap.set(signature, next)
      setOutcome(next)
    } finally {
      setUndoing(false)
    }
  }

  if (operations.length === 0) return <pre>{jsonString}</pre>

  const box: React.CSSProperties = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-surface-offset)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    margin: '8px 0',
    fontSize: 'var(--text-xs)'
  }

  if (error) {
    return (
      <div style={{ ...box, color: 'var(--color-error)', borderColor: 'var(--color-error-muted)' }}>
        ⚠ Could not apply board settings: {error}
      </div>
    )
  }

  if (!outcome) {
    return <div style={{ ...box, color: 'var(--color-text-muted)' }}>Applying board settings…</div>
  }

  return (
    <div style={box}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 'var(--space-3)', marginBottom: outcome.summary.length ? 'var(--space-2)' : 0
      }}>
        <strong style={{ color: 'var(--color-text-base)' }}>
          {outcome.undone ? 'Board settings reverted' : 'Board settings updated'}
        </strong>
        {!outcome.undone && outcome.inverse.length > 0 && (
          <button
            onClick={handleUndo}
            disabled={undoing}
            className="btn-secondary"
            style={{ fontSize: 'var(--text-xs)', padding: '2px 10px' }}
          >
            {undoing ? 'Undoing…' : 'Undo'}
          </button>
        )}
      </div>

      {!outcome.undone && outcome.summary.map((line, i) => (
        <div key={i} style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>• {line}</div>
      ))}

      {outcome.movedCards.length > 0 && !outcome.undone && (
        <div style={{ color: 'var(--color-text-faint)', marginTop: 'var(--space-1)' }}>
          {outcome.movedCards.length} card(s) moved out of the deleted column.
        </div>
      )}

      {outcome.skipped.length > 0 && !outcome.undone && (
        <div style={{ marginTop: 'var(--space-2)', color: 'var(--color-warning)' }}>
          {outcome.skipped.map((line, i) => <div key={i}>• Skipped: {line}</div>)}
        </div>
      )}
    </div>
  )
}

function CreateTaskActionBlock({ jsonString }: { jsonString: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const selectItem = useAppStore(s => s.selectItem)
  const setView = useAppStore(s => s.setView)
  const [createdItem, setCreatedItem] = useState<Item | null>(null)
  const [itemTags, setItemTags] = useState<Tag[]>([])
  const [error, setError] = useState<string | null>(null)

  const normalized = normalizeCardJson(jsonString)
  const title = normalized?.title || ''
  const signature = title ? `card::${activeWorkspace || 'default'}::${title.toLowerCase()}` : ''

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

        const validContext = activeWorkspace || 'default'

        const created = await withLock(`kanban-cards:${validContext}`, async () => {
          const existingItemsRes = await window.electronAPI.db.getItems(validContext, 'card', 1, 1000).catch(() => ({ items: [] }))
          const existingCard = (existingItemsRes?.items || []).find(ci => ci.status !== 'archived' && ci.title.trim().toLowerCase() === title.trim().toLowerCase())

          if (existingCard) {
            createdItemsCacheMap.set(signature, { item: existingCard, tags: [] })
            return { item: existingCard, tags: [], isNew: false }
          }

          const body = normalized.body || ''
          const priority = normalized.priority ?? 2

          // Resolve status to match existing board column IDs
          let finalStatus = 'open'
          // Unified board document; read unlocked inside the existing lock.
          const { columns: cols } = await readBoardConfigUnlocked(validContext)

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
          // Nameless tags are skipped rather than thrown on: reading `.name` off
          // whatever the model sent used to fail the whole card.
          const createdTagsList: Tag[] = Array.isArray(normalized.tags)
            ? await (await tagResolver())(
                normalized.tags
                  .map(t => ({ name: tagNameOf(t) ?? '', color: tagColorOf(t, '#3b82f6') }))
                  .filter(t => t.name)
              )
            : []
          const tagIds = createdTagsList.map(tag => tag.id)

          const newItem = await window.electronAPI.db.createItem({
            context: validContext,
            type: 'card',
            title,
            body,
            status: finalStatus,
            priority,
            // Explicit position. Omitting it defaults to 0 in the IPC validator,
            // pinning the card above everything and breaking drag-reordering.
            position: Date.now(),
            due_at: null,
            metadata: '{}'
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
      } catch (e) {
        if (isMounted) setError(errorText(e))
      }
    }
    autoCreate()
    return () => { isMounted = false }
  }, [jsonString, activeWorkspace, signature])

  // Look up the human-readable column name for whatever status ID this card has.
  // Must stay above the early returns below: this block renders a "generating"
  // placeholder while `data` is still streaming in, so hooks placed after those
  // returns would change in count once the card resolves, and React would throw.
  const [colDisplayName, setColDisplayName] = React.useState<string>('')
  React.useEffect(() => {
    if (!data) return
    const lookup = async () => {
      try {
        const ctx = activeWorkspace || 'default'
        const { columns: cols } = await loadBoardConfig(ctx)
        const match = cols.find(c =>
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
  }, [data?.status, activeWorkspace])

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


  const priorityColor = data.priority === 3 ? '#ef4444' : data.priority === 2 ? '#eab308' : 'var(--color-text-muted)'
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-primary-soft)', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.02em', flexShrink: 0 }}>
          <CheckCircle2 size={14} style={{ color: '#3b82f6', flexShrink: 0 }} />
          <span>Added to board</span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, minWidth: 0 }}>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 'bold',
              background: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--color-primary-soft)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              maxWidth: '120px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text-base)', lineHeight: 1.4, wordBreak: 'break-word' }}>
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
          {(currentTags.length > 0 ? currentTags : asArray(data.tags)).map((t, idx) => {
            const tagName = tagNameOf(t)
            const tagColor = tagColorOf(t, '#3b82f6')
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
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const [createdCol, setCreatedCol] = useState<ColumnConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  const normalized = normalizeColumnJson(jsonString)
  const name = normalized?.name || ''
  const signature = name ? `col::${activeWorkspace || 'default'}::${name.toLowerCase()}` : ''

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
        const colorMode = toColorMode(normalized.colorMode)
        const context = activeWorkspace || 'default'

        const newCol = await withLock(boardConfigLockKey(context), async () => {
          const config = await readBoardConfigUnlocked(context)
          const colsList: ColumnConfig[] = [...config.columns]

          // Prevent duplicate column names
          const existing = colsList.find(c => c.name.toLowerCase() === name.toLowerCase())
          if (existing) {
            createdColsCacheMap.set(signature, existing)
            return existing
          }

          const id = `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
          const created = { id, name, wipLimit, color, colorMode }
          const updatedCols = [...colsList, created]

          await writeBoardConfigUnlocked(context, { ...config, columns: updatedCols })
          createdColsCacheMap.set(signature, created)
          return created
        })

        // Dispatch live update event to reload Kanban board instantly
        window.dispatchEvent(new CustomEvent('kanban-refresh'))

        if (isMounted) setCreatedCol(newCol)
      } catch (e) {
        if (isMounted) setError(errorText(e))
      }
    }
    autoCreateCol()
    return () => { isMounted = false }
  }, [jsonString, activeWorkspace, signature])

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: colData.color || '#3b82f6', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.02em', flexShrink: 0 }}>
          <Columns size={14} style={{ flexShrink: 0 }} />
          <span>Created column</span>
        </div>
        {colData.wipLimit !== null && (
          <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '12px', fontWeight: 'bold', background: 'rgba(255,255,255,0.1)', color: 'var(--color-text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            WIP Limit: {colData.wipLimit}
          </span>
        )}
      </div>

      <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: colData.color, boxShadow: `0 0 10px ${colData.color}aa`, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{colData.name}</span>
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
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()

  const parsed = faultTolerantParseJSON(jsonString)

  // Derived with null-safe defaults so every hook below runs unconditionally.
  // The `!parsed` bail-out has to sit *after* the hooks: streaming AI output is
  // routinely unparseable on early renders and only parses once complete, so
  // returning first would change this component's hook count mid-life and make
  // React throw "rendered more hooks than during the previous render".
  //
  // A non-object (the model answered with an array) still renders the plan
  // shell with zero steps; only `null` reaches the bail-out further down.
  const root = asObject(parsed) ?? {}
  // Field-for-field with what the block declares. No alias widening, so a step
  // that rendered blank before still renders blank.
  const planTitle = str(root.title)
  const planOverview = str(root.overview)
  const steps: AiPlanStep[] = asArray(root.steps).map(s => {
    const o = asObject(s) ?? {}
    return { title: str(o.title), details: str(o.details), status: str(o.status) }
  })

  // Stable localStorage key for per-step approval persistence (survives chat reload)
  const planSignature = `checkpoint_plan::${planTitle.replace(/s+/g, '_').slice(0, 40)}::${steps.length}`

  const readStoredApprovals = (sig: string, count: number): boolean[] => {
    try {
      const stored = localStorage.getItem(sig)
      if (stored) {
        const arr = JSON.parse(stored)
        if (Array.isArray(arr) && arr.length === count) return arr
      }
    } catch {}
    return Array.from({ length: count }, () => true) // all approved by default
  }

  const [stepApprovals, setStepApprovals] = useState<boolean[]>(() =>
    readStoredApprovals(planSignature, steps.length)
  )

  const [phase, setPhase] = useState<'review' | 'committed'>(() => {
    try {
      return localStorage.getItem(planSignature + '_committed') === '1' ? 'committed' : 'review'
    } catch {}
    return 'review'
  })

  const [exportedCount, setExportedCount] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [activeStepIndex, setActiveStepIndex] = useState(0)

  // Those initializers only run on the very first render, which may land before
  // the plan JSON is parseable. Re-read persisted state once the real steps
  // arrive, otherwise the block would stay stuck on the empty-plan defaults.
  useEffect(() => {
    setStepApprovals(prev =>
      prev.length === steps.length ? prev : readStoredApprovals(planSignature, steps.length)
    )
    try {
      setPhase(localStorage.getItem(planSignature + '_committed') === '1' ? 'committed' : 'review')
    } catch {}
  }, [planSignature, steps.length])

  if (!parsed) return <pre>{jsonString}</pre>

  const toggleStep = (idx: number) => {
    if (phase !== 'review') return
    setStepApprovals(prev => {
      const next = [...prev]
      next[idx] = !next[idx]
      try { localStorage.setItem(planSignature, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const approvedSteps = steps.filter((_, i) => stepApprovals[i] !== false)
  const approvedCount = approvedSteps.length
  const skippedCount = steps.length - approvedCount

  const handleCommit = async () => {
    let count = 0
    const context = activeWorkspace || 'default'
    const posBase = Date.now() // ascending positions keep plan order on the board
    for (const step of approvedSteps) {
      try {
        await window.electronAPI.db.createItem({
          context, type: 'card',
          title: step.title || 'Plan Step',
          body: step.details || '',
          status: 'open',
          priority: 2,
          position: posBase + count * 10,
          due_at: null, metadata: '{}'
        }, [])
        count++
      } catch (e) { console.warn('Failed to export plan step:', e) }
    }
    setExportedCount(count)
    setPhase('committed')
    try { localStorage.setItem(planSignature + '_committed', '1') } catch {}
    window.dispatchEvent(new CustomEvent('kanban-refresh'))
    toast(`${count} plan step${count !== 1 ? 's' : ''} added to Kanban board!`, { type: 'success' })
  }

  const handleExportMarkdown = async () => {
    let md = `# ${planTitle || 'Implementation Plan'}\n\n`
    if (planOverview) md += `## Overview\n\n${planOverview}\n\n`
    md += `## Steps\n\n`
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      const approved = stepApprovals[i] !== false
      md += `- [${approved ? ' ' : 'x'}] **${s.title}**\n${s.details ? `  ${s.details}\n` : ''}\n`
    }
    const success = await window.electronAPI.app.saveFile('implementation_plan.md', md)
    if (success) toast('Implementation plan saved as Markdown!', { type: 'success' })
  }

  const btnBase: React.CSSProperties = {
    border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '5px 12px', fontSize: '11px', fontWeight: 'bold',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
  }

  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      margin: '12px 0',
      boxShadow: 'var(--shadow-sm)',
      transition: 'border-color 300ms ease'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '12px', fontWeight: 'bold', color: phase === 'committed' ? 'var(--color-success-soft)' : 'var(--color-info)' }}>
          <Sparkles size={14} style={{ flexShrink: 0 }} />
          <span>Implementation Plan</span>
          {phase === 'review' && (
            <span style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', color: '#7dd3fc', fontSize: '9px', padding: '1px 6px', borderRadius: '10px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
              Awaiting Approval
            </span>
          )}
          {phase === 'committed' && (
            <span style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--color-success-soft)', fontSize: '9px', padding: '1px 6px', borderRadius: '10px', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
              ✓ Committed
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowModal(true)}
            style={{
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              color: 'var(--color-info)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 8px',
              fontSize: '10px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap'
            }}
          >
            <Layout size={11} /> Expand Plan
          </button>
          {phase === 'review' && (
            <span style={{ fontSize: '9px', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '8px', whiteSpace: 'nowrap' }}>
              {approvedCount}/{steps.length} approved
            </span>
          )}
          {phase === 'committed' && exportedCount !== null && (
            <span style={{ fontSize: '9px', color: 'var(--color-success-soft)', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: '8px', whiteSpace: 'nowrap' }}>
              {exportedCount} card{exportedCount !== 1 ? 's' : ''} created
            </span>
          )}
        </div>
      </div>

      {/* Plan Title + Overview */}
      <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#f1f5f9', marginBottom: planOverview ? '6px' : '10px', whiteSpace: 'normal', wordBreak: 'break-word' }}>{planTitle}</div>
      {planOverview && (
        <div style={{
          fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '12px', lineHeight: 1.6,
          background: 'rgba(255,255,255,0.03)',
          borderLeft: `2px solid ${phase === 'committed' ? 'rgba(34,197,94,0.4)' : 'rgba(56,189,248,0.4)'}`,
          paddingLeft: '10px', borderRadius: '0 4px 4px 0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}>
          {planOverview}
        </div>
      )}

      {/* Step List. Phase 1: clickable toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '14px' }}>
        {steps.map((s, idx) => {
          const isApproved = stepApprovals[idx] !== false
          return (
            <div
              key={idx}
              onClick={() => toggleStep(idx)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                background: isApproved ? 'rgba(56,189,248,0.05)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isApproved ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 'var(--radius-sm)', padding: '8px 10px',
                cursor: phase === 'review' ? 'pointer' : 'default',
                transition: 'all 150ms ease',
                opacity: isApproved ? 1 : 0.45
              }}
            >
              {/* Toggle indicator */}
              <div style={{
                width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, marginTop: '1px',
                border: `2px solid ${isApproved ? 'var(--color-info)' : 'rgba(255,255,255,0.2)'}`,
                background: isApproved ? 'rgba(56,189,248,0.2)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 150ms ease'
              }}>
                {isApproved && <Check size={10} color="#38bdf8" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '11px', fontWeight: 'bold',
                  color: isApproved ? '#e2e8f0' : '#64748b',
                  textDecoration: isApproved ? 'none' : 'line-through',
                  marginBottom: s.details ? '2px' : '0'
                }}>
                  {s.title}
                </div>
                {s.details && (
                  <div style={{ fontSize: '10px', color: isApproved ? 'var(--color-text-muted)' : 'var(--color-text-faint)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {s.details}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Action Buttons */}
      {phase === 'review' ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
          <button
            onClick={handleExportMarkdown}
            style={{ ...btnBase, background: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
          >
            <FileText size={12} style={{ color: 'var(--color-info)' }} />
            <span>Save as .md</span>
          </button>
          <button
            onClick={handleCommit}
            disabled={approvedCount === 0}
            style={{
              ...btnBase,
              background: approvedCount === 0 ? 'rgba(255,255,255,0.05)' : '#0284c7',
              color: approvedCount === 0 ? 'var(--color-text-faint)' : '#fff',
              cursor: approvedCount === 0 ? 'not-allowed' : 'pointer'
            }}
            onMouseEnter={e => { if (approvedCount > 0) (e.currentTarget as HTMLButtonElement).style.background = '#0369a1' }}
            onMouseLeave={e => { if (approvedCount > 0) (e.currentTarget as HTMLButtonElement).style.background = '#0284c7' }}
          >
            <CheckCircle2 size={12} />
            <span>Approve &amp; Export to Kanban ({approvedCount})</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
          <span style={{ fontSize: '10px', color: '#64748b' }}>
            {skippedCount > 0 ? `${skippedCount} step${skippedCount !== 1 ? 's' : ''} skipped` : 'All steps exported'}
          </span>
          <button
            onClick={() => setView('kanban')}
            style={{ ...btnBase, background: 'var(--color-surface-offset)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-text-base)' }}
          >
            <Layout size={12} />
            <span>View on Kanban</span>
            <ArrowRight size={11} />
          </button>
        </div>
      )}

      {/* Modal Overlay detail view */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(10, 12, 18, 0.85)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px', boxSizing: 'border-box'
        }}>
          <style>{`
            .plan-markdown-body {
              font-size: 11px;
              line-height: 1.5;
              color: var(--color-text-muted);
              white-space: normal;
              word-break: break-word;
            }
            .plan-markdown-body p {
              margin: 0 0 6px 0;
              white-space: normal;
              word-break: break-word;
            }
            .plan-markdown-body p:last-child {
              margin-bottom: 0;
            }
            .plan-markdown-body ul, .plan-markdown-body ol {
              margin: 2px 0 6px 0;
              padding-left: 16px;
            }
            .plan-markdown-body li {
              margin-bottom: 3px;
            }
            .plan-markdown-body li > p {
              margin: 0;
              display: inline;
            }
            .plan-markdown-body li::marker {
              color: var(--color-secondary);
            }
            .plan-markdown-body strong, .plan-markdown-body b {
              color: var(--color-text-base);
              font-weight: bold;
            }
            .plan-markdown-body blockquote {
              border-left: 3px solid var(--color-secondary);
              background: var(--color-surface-offset);
              margin: 8px 0;
              padding: 6px 10px;
              color: var(--color-text-muted);
              font-style: italic;
              border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
            }
            .plan-markdown-body code {
              background: var(--color-surface-offset);
              color: var(--color-text-base);
              padding: 2px 4px;
              border-radius: var(--radius-sm);
              font-family: var(--font-mono);
              font-size: 10px;
            }
          `}</style>
          <div style={{
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: '1000px', height: '85vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: 'var(--shadow-lg)', overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--color-surface-offset)',
              background: 'var(--color-surface-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Sparkles size={16} style={{ color: 'var(--color-secondary)' }} />
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--color-text-base)', letterSpacing: '-0.01em' }}>
                  Plan Review: {planTitle}
                </span>
              </div>
              <button onClick={() => setShowModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 150ms' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-base)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
              {/* Left Column: Steps list */}
              <div style={{
                width: '320px', borderRight: '1px solid var(--color-surface-offset)',
                overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px',
                padding: '18px', background: 'var(--color-surface-1)', flexShrink: 0
              }}>
                <div style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--color-text-faint)', textTransform: 'uppercase', marginBottom: '10px', letterSpacing: '0.08em' }}>
                  Steps Checklist ({approvedCount}/{steps.length} approved)
                </div>
                {steps.map((s, idx) => {
                  const isApproved = stepApprovals[idx] !== false
                  const isSelected = activeStepIndex === idx
                  return (
                    <div
                      key={idx}
                      onClick={() => setActiveStepIndex(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        background: isSelected ? 'var(--color-surface-offset)' : 'transparent',
                        borderLeft: `3px solid ${isSelected ? 'var(--color-secondary)' : 'transparent'}`,
                        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                        padding: '10px 14px 10px 10px',
                        cursor: 'pointer', transition: 'all 150ms ease',
                        marginBottom: '2px'
                      }}
                      onMouseEnter={e => {
                        if (!isSelected) e.currentTarget.style.background = 'var(--color-surface-offset)'
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {/* Round Checkbox indicator */}
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleStep(idx) }}
                        style={{
                          width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                          border: `2px solid ${isApproved ? 'var(--color-success)' : 'var(--color-text-faint)'}`,
                          background: isApproved ? 'var(--color-success)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 150ms ease',
                          cursor: 'pointer'
                        }}
                        title={isApproved ? "Click to Skip step" : "Click to Approve step"}
                      >
                        {isApproved && <Check size={10} color="#fff" strokeWidth={3} />}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: isSelected ? 'var(--color-secondary)' : 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                          Step 0{idx + 1}
                        </span>
                        <span style={{
                          fontSize: '11px', fontWeight: isSelected ? 'bold' : 'normal',
                          color: isApproved ? (isSelected ? 'var(--color-text-base)' : 'var(--color-text-muted)') : 'var(--color-text-faint)',
                          textDecoration: isApproved ? 'none' : 'line-through',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}>
                          {s.title}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Right Column: Step details */}
              <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '32px', background: 'var(--color-surface-2)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {steps[activeStepIndex] ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid var(--color-surface-offset)', paddingBottom: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--color-secondary)', fontWeight: 'bold', letterSpacing: '0.1em' }}>
                          STEP DETAILS • 0{activeStepIndex + 1} OF {steps.length}
                        </span>
                        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--color-text-base)', letterSpacing: '-0.01em' }}>
                          {steps[activeStepIndex].title}
                        </h2>
                      </div>
                      <button
                        onClick={() => toggleStep(activeStepIndex)}
                        style={{
                          background: stepApprovals[activeStepIndex] !== false ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                          border: `1px solid ${stepApprovals[activeStepIndex] !== false ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                          color: stepApprovals[activeStepIndex] !== false ? 'var(--color-success-soft)' : '#f87171',
                          borderRadius: '20px', padding: '6px 14px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 150ms ease'
                        }}
                      >
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: stepApprovals[activeStepIndex] !== false ? '#22c55e' : '#ef4444' }} />
                        {stepApprovals[activeStepIndex] !== false ? 'Approved' : 'Skipped'}
                      </button>
                    </div>

                    <div className="plan-markdown-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={url => url}
                      >
                        {steps[activeStepIndex].details || '*No details provided for this step.*'}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-faint)', fontSize: '12px' }}>
                    Select a step on the left to see details
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--color-surface-offset)',
              background: 'var(--color-surface-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', flexShrink: 0
            }}>
              {phase === 'review' ? (
                <>
                  <button
                    onClick={handleExportMarkdown}
                    style={{
                      ...btnBase,
                      background: 'var(--color-surface-offset)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'opacity 150ms ease'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    <FileDown size={13} /> Save as .md
                  </button>
                  <button
                    onClick={() => { handleCommit(); setShowModal(false) }}
                    style={{
                      ...btnBase,
                      background: 'var(--color-secondary)',
                      color: 'var(--color-text-inverted)',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-sm)',
                      transition: 'opacity 150ms ease'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.9' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    <CheckCircle2 size={13} /> Approve &amp; Export to Kanban ({approvedCount})
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    ...btnBase,
                    background: 'var(--color-surface-offset)',
                    border: '1px solid var(--color-surface-offset)',
                    color: 'var(--color-text-base)',
                    padding: '8px 20px',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'opacity 150ms ease'
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateDialogueTreeActionBlock({ jsonString }: { jsonString: string }) {
  const setView = useAppStore(s => s.setView)
  const { toast } = useToast()
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const parsed = faultTolerantParseJSON(jsonString)
  if (!parsed) return <pre>{jsonString}</pre>

  // `parsed` stays raw: it is handed verbatim to the Dialogue Builder and to the
  // JSON export, so it must not be reshaped. Only the preview reads `nodes`.
  const root = asObject(parsed) ?? {}
  const startNode = str(root.startNode)
  const nodes: AiDialogueNode[] = asArray(root.nodes).map(n => {
    const o = asObject(n) ?? {}
    return {
      id: str(o.id),
      speaker: str(o.speaker),
      text: str(o.text),
      choices: asArray(o.choices).map((c): AiDialogueChoice => {
        const co = asObject(c) ?? {}
        return { text: str(co.text), target: str(co.target) }
      })
    }
  })
  const PREVIEW_LIMIT = 3
  const visibleNodes = expanded ? nodes : nodes.slice(0, PREVIEW_LIMIT)

  const handleLoadTree = () => {
    window.dispatchEvent(new CustomEvent(AI_DIALOGUE_EVENT, { detail: parsed }))
    setLoaded(true)
    setView('gamedev')
  }

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(parsed, null, 2))
      .then(() => toast('Dialogue tree JSON copied!', { type: 'success' }))
      .catch(() => {})
  }

  const handleSaveJson = async () => {
    const fname = `dialogue_${(startNode || 'tree').replace(/\s+/g, '_')}.json`
    const success = await window.electronAPI.app.saveFile(fname, JSON.stringify(parsed, null, 2))
    if (success) toast('Dialogue tree saved as JSON!', { type: 'success' })
  }

  const handleSaveMd = async () => {
    let md = `# Dialogue Tree\n\nStart Node: \`${startNode || 'start'}\`\n\n---\n\n`
    for (const n of nodes) {
      md += `## Node: \`${n.id}\`\n\n**${n.speaker || 'NPC'}:** "${n.text}"\n\n`
      if (Array.isArray(n.choices) && n.choices.length > 0) {
        md += `**Player Choices:**\n\n`
        for (const c of n.choices) md += `- "${c.text}" → \`${c.target}\`\n`
        md += '\n'
      }
      md += '---\n\n'
    }
    const success = await window.electronAPI.app.saveFile('dialogue_tree.md', md)
    if (success) toast('Dialogue tree saved as Markdown!', { type: 'success' })
  }

  const iconBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)', padding: '4px 10px',
    fontSize: '10px', fontWeight: 'bold', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '5px'
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(18, 10, 32, 0.97), rgba(10, 5, 20, 0.99))',
      border: '1px solid rgba(168, 85, 247, 0.3)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      margin: '12px 0',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', fontWeight: 'bold', color: '#a855f7' }}>
          <Sparkles size={14} />
          <span>Branching Dialogue &amp; Quest Flow</span>
        </div>
        <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', padding: '2px 8px', borderRadius: '10px' }}>
          {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Node List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
        {visibleNodes.map((n, idx) => (
          <div key={idx} style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(168,85,247,0.15)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px'
          }}>
            {/* Speaker chip + node ID */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <span style={{
                fontSize: '9px', background: 'rgba(168,85,247,0.2)',
                border: '1px solid rgba(168,85,247,0.4)', color: 'var(--color-accent-ai-soft)',
                padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold'
              }}>{n.speaker || 'NPC'}</span>
              <span style={{ fontSize: '9px', color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>id: {n.id}</span>
            </div>
            {/* Dialogue text */}
            <div style={{ fontSize: '11px', color: '#e4e4e7', lineHeight: 1.5, marginBottom: Array.isArray(n.choices) && n.choices.length > 0 ? '6px' : '0' }}>
              &ldquo;{n.text}&rdquo;
            </div>
            {/* Choices with target arrows */}
            {Array.isArray(n.choices) && n.choices.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {n.choices.map((c, ci) => (
                  <span key={ci} style={{
                    fontSize: '9px', background: 'rgba(168,85,247,0.1)',
                    color: 'var(--color-accent-ai-soft)', padding: '2px 7px', borderRadius: '4px',
                    border: '1px solid rgba(168,85,247,0.25)',
                    display: 'flex', alignItems: 'center', gap: '4px'
                  }}>
                    <span>{c.text}</span>
                    <ArrowRight size={8} style={{ opacity: 0.6 }} />
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#a78bfa', fontSize: '8px' }}>{c.target}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Expand/collapse toggle */}
      {nodes.length > PREVIEW_LIMIT && (
        <button
          onClick={() => setExpanded(prev => !prev)}
          style={{ background: 'none', border: 'none', color: 'var(--color-accent-ai)', fontSize: '11px', cursor: 'pointer', padding: '2px 0', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          {expanded
            ? `▲ Collapse (${nodes.length} nodes total)`
            : `▼ Show all ${nodes.length} nodes (${nodes.length - PREVIEW_LIMIT} hidden)`}
        </button>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', borderTop: '1px solid rgba(168,85,247,0.15)', paddingTop: '10px', justifyContent: 'flex-end' }}>
        <button
          onClick={handleCopyJson}
          style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <Copy size={11} /> <span>Copy JSON</span>
        </button>
        <button
          onClick={handleSaveJson}
          style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <FileDown size={11} /> <span>Save .json</span>
        </button>
        <button
          onClick={handleSaveMd}
          style={iconBtn}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <FileText size={11} /> <span>Save .md</span>
        </button>
        <button
          onClick={handleLoadTree}
          style={{
            // Once loaded this is a plain surface, not a white veil: the veil
            // was invisible in the light theme, and so was the white on it.
            background: loaded ? 'var(--color-surface-offset)' : 'var(--color-accent-ai)',
            border: 'none',
            color: loaded ? 'var(--color-text-muted)' : 'var(--color-on-accent)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 12px', fontSize: '10px', fontWeight: 'bold',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px'
          }}
          onMouseEnter={e => { if (!loaded) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-ai-hover)' }}
          onMouseLeave={e => { if (!loaded) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-ai)' }}
        >
          <Layout size={11} />
          <span>{loaded ? 'Loaded in Game Dev' : 'Load into Dialogue Builder'}</span>
          <ArrowRight size={10} />
        </button>
      </div>
    </div>
  )
}

// Clickable card references
// Known card titles mentioned in assistant prose become internal #card: links
// that open the card's detail panel. Titles are cached per-context with a
// short TTL and invalidated by kanban-refresh events.
let boardTitlesCache: { ctx: string; ts: number; entries: Array<{ title: string; id: string }> } | null = null
// Single-flight: every ChatMessage instance shares ONE in-flight fetch so all
// messages receive the same entries in the same React batch. Without this,
// each message fetched independently and re-laid-out at a slightly different
// moment, making the chat visibly bounce up and down.
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
        window.electronAPI.db.getItems(context, 'task', 1, 500).catch(() => ({ items: [] })),
        window.electronAPI.db.getItems(context, 'card', 1, 500).catch(() => ({ items: [] }))
      ])
      const items = [...(t?.items || []), ...(c?.items || [])].filter(i => i.status !== 'archived')
      const list = items
        .map(i => ({ title: str(i.title).trim(), id: i.id }))
        // Short titles false-positive on prose; markdown-special chars break link syntax.
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

function useBoardTitles(context: string, enabled: boolean): Array<{ title: string; id: string }> {
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Wraps known card titles in assistant prose with internal #card: links.
 * Fenced code blocks and inline code spans are left untouched; each title is
 * linked at most once per message to avoid link spam.
 */
function linkifyCardTitles(content: string, entries: Array<{ title: string; id: string }>): string {
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

function ChatMessage({ message, messageIndex, onResend, onRewrite, onRevert, onCopy, isCopied, isStreaming, hasRevertAction }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  // Card-title linkification only for committed assistant messages (streaming
  // text shifts constantly; user text is their own words). Memoized: the
  // regex sweep over up to 80 titles must not run on unrelated re-renders.
  const boardTitles = useBoardTitles(activeWorkspace || 'default', !isUser && !isStreaming)
  const renderedContent = React.useMemo(
    () => (!isUser && !isStreaming) ? linkifyCardTitles(message.content, boardTitles) : message.content,
    [isUser, isStreaming, message.content, boardTitles]
  )
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(message.displayContent || message.content)
  const [showThinking, setShowThinking] = useState(false)

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
    // Timestamp/copy reveal is pure CSS (.chat-msg-row:hover). A state-driven
    // hover re-rendered the whole message subtree (ReactMarkdown + action
    // blocks) on every mouse crossing, which made the chat visibly stutter.
    <div
      className="chat-msg-row"
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        width: '100%',
        boxSizing: 'border-box'
      }}
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
                color: 'var(--color-primary-soft)'
              }}
            >
              <BookOpen size={12} />
              <span>{csName}</span>
            </div>
          ))}

          {message.notes && message.notes.map((noteTitle, idx) => (
            <div
              key={`n-${idx}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: 'rgba(34, 197, 94, 0.14)', border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: 'var(--radius-sm)', padding: '2px 8px',
                fontSize: '10px', fontWeight: 'bold', color: 'var(--color-success-soft)'
              }}
            >
              <FileText size={12} />
              <span>{noteTitle}</span>
            </div>
          ))}

          {message.files && message.files.map((filePath, idx) => (
            <div
              key={`f-${idx}`}
              title={filePath}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                background: 'rgba(56, 189, 248, 0.14)', border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 'var(--radius-sm)', padding: '2px 8px',
                fontSize: '10px', fontWeight: 'bold', color: 'var(--color-info)'
              }}
            >
              <FileText size={12} />
              <span>{filePath.split(/[\\/]/).pop()}</span>
            </div>
          ))}
        </div>

        {/* Attached images (vision input) */}
        {message.images && message.images.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
            {message.images.map((src, idx) => (
              <img
                key={idx}
                src={src}
                alt={`attachment ${idx + 1}`}
                style={{
                  width: '84px', height: '84px', objectFit: 'cover',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-surface-offset)',
                  cursor: 'zoom-in'
                }}
                onClick={e => {
                  // Simple lightbox: toggle between thumbnail and large preview
                  const img = e.currentTarget
                  const large = img.style.width !== '84px'
                  img.style.width = large ? '84px' : '260px'
                  img.style.height = large ? '84px' : 'auto'
                  img.style.cursor = large ? 'zoom-in' : 'zoom-out'
                }}
              />
            ))}
          </div>
        )}

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
              <span className="msg-hover-reveal" style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
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
            {message.thinking && (
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                marginBottom: '10px',
                fontSize: '11px'
              }}>
                <button
                  onClick={() => setShowThinking(prev => !prev)}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    color: 'var(--color-secondary)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '5px',
                    fontSize: '10px', fontWeight: 'bold'
                  }}
                >
                  <Brain size={12} style={{ color: 'var(--color-secondary)' }} />
                  <span>{showThinking ? 'Hide Thinking Process' : 'Show Thinking Process'}</span>
                  <span style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
                    ({Math.ceil(message.thinking.length / 4)} tokens)
                  </span>
                </button>
                {showThinking && (
                  <div style={{
                    marginTop: '6px',
                    paddingTop: '6px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.04)',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    fontStyle: 'italic',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px'
                  }}>
                    {message.thinking}
                  </div>
                )}
              </div>
            )}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={url => url}
              components={{
                a({ href, children }) {
                  // Internal card reference. Open the card's detail panel
                  if (href && href.startsWith('#card:')) {
                    const cardId = href.slice(6)
                    return (
                      <a
                        href={href}
                        onClick={e => { e.preventDefault(); useAppStore.getState().selectItem(cardId) }}
                        title="Open card details"
                        style={{ color: 'var(--color-secondary)', fontWeight: 600, textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer' }}
                      >
                        {children}
                      </a>
                    )
                  }
                  // External links open in the system browser, not inside the app
                  return (
                    <a
                      href={href}
                      onClick={e => {
                        e.preventDefault()
                        if (href) window.electronAPI.app.openExternal(href).catch(() => {})
                      }}
                      style={{ color: 'var(--color-primary)', cursor: 'pointer' }}
                    >
                      {children}
                    </a>
                  )
                },
                code({ className, children, ...props }) {
                  const match = /language-([^\s]+)/.exec(className || '')
                  const lang = match ? match[1] : ''
                  const rawContent = String(children)

                  // Step 1: Explicit language tag wins. Use the rich single-block UIs
                  // Checked before update_board: "configure_board" contains
                  // neither substring, but keeping the more specific tag first
                  // keeps the ordering obvious if either name ever changes.
                  if (lang === 'configure_board' || lang.includes('configure_board')) {
                    return <ConfigureBoardActionBlock jsonString={rawContent} dedupeKey={String(message.timestamp ?? messageIndex ?? '')} />
                  }
                  if (lang === 'update_board' || lang.includes('update_board')) {
                    return <UpdateBoardActionBlock jsonString={rawContent} dedupeKey={String(message.timestamp ?? messageIndex ?? '')} />
                  }
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

                  // Step 2: Generic JSON. Try batch (handles all AI output formats)
                  if (lang === 'json' || lang === 'create_batch' || lang === 'batch' || lang === '') {
                    const batch = parseBatchBoardJson(rawContent)
                    if (batch && (batch.columns.length > 0 || batch.cards.length > 0)) {
                      return <BatchBoardActionBlock jsonString={rawContent} />
                    }
                  }

                  // Step 3: Unlabelled fenced block. Try all parsers as a last resort
                  if (!lang || lang === 'json') {
                    const normCard = normalizeCardJson(rawContent)
                    if (normCard) return <CreateTaskActionBlock jsonString={rawContent} />
                    const normCol = normalizeColumnJson(rawContent)
                    if (normCol) return <CreateColumnActionBlock jsonString={rawContent} />
                  }

                  // Fallback: plain code block
                  const isBlock = className?.includes('language-') || String(children).includes('\n')
                  return isBlock ? (
                    <CodeBlock
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
              {renderedContent}
            </ReactMarkdown>

            {/* Blinking cursor at end of streaming message */}
            {isStreaming && (
              <span className="ai-streaming-cursor" />
            )}

            {/* Bottom row: timestamp + copy button */}
            <div
              className={`msg-meta-row ${isCopied ? 'force-visible' : ''}`}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: '6px', paddingTop: '4px'
              }}
            >
              <span className="msg-hover-reveal" style={{ fontSize: '9px', color: 'var(--color-text-faint)' }}>
                {relativeTime(message.timestamp)}
              </span>
              {onCopy && messageIndex !== undefined && (
                <button
                  onClick={() => onCopy(message.displayContent || message.content, messageIndex)}
                  className={`msg-hover-reveal ${isCopied ? 'force-visible' : ''}`}
                  style={{
                    background: 'transparent', border: 'none',
                    color: isCopied ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '2px 4px', borderRadius: '4px', fontSize: '10px'
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
// Memoized on data props only: the panel re-renders on every keystroke, and
// re-rendering every committed message (ReactMarkdown + title linkify) made
// the chat visibly stutter. Handler props are recreated each render but only
// close over the message PREFIX up to this index, which never changes for a
// committed message. `actionsLocked` (the panel's isStreaming) is compared so
// handlers pick up fresh closures whenever streaming starts/stops.
export default React.memo(ChatMessage, (prev, next) =>
  prev.message === next.message &&
  prev.messageIndex === next.messageIndex &&
  prev.isCopied === next.isCopied &&
  prev.isStreaming === next.isStreaming &&
  prev.hasRevertAction === next.hasRevertAction &&
  prev.actionsLocked === next.actionsLocked
)
