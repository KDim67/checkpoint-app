import { useState, useEffect, useRef } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useAppStore } from '../../../store/appStore'
import { withLock } from '../../../lib/asyncMutex'
import {
  boardConfigLockKey,
  readBoardConfigUnlocked,
  writeBoardConfigUnlocked,
  type ColumnConfig
} from '../../../lib/boardConfig'
import type { BatchCard } from '../aiActionTypes'
import { asArray, tagColorOf, tagNameOf, toColorMode } from '../aiActionTypes'
import { parseBatchBoardJson, resolveColor } from '../aiActionParse'
import { tagResolver } from '../../../data/tags'
import { createItem, readItems } from '../../../data/items'
import { executedActionSignaturesSet, errorText, type ShownColumn } from './shared'
import ViewOnKanbanButton from './ViewOnKanbanButton'

export default function BatchBoardActionBlock({ jsonString }: { jsonString: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const [completedData, setCompletedData] = useState<{ columns: ShownColumn[]; cards: BatchCard[]; skippedCards?: number; reusedCols?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const batchData = parseBatchBoardJson(jsonString)
  const signature = batchData ? `batch::${activeWorkspace || 'default'}::${batchData.columns.map(c => c.name).join(',')}_${batchData.cards.map(c => c.title).join(',')}` : ''

  // Rebuilt from the JSON on every render, so read through a ref rather than
  // listed: listing it would run the effect on every render.
  const parsedRef = useRef(batchData)
  parsedRef.current = batchData

  useEffect(() => {
    let isMounted = true
    const batchData = parsedRef.current
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
          const existingCards = await readItems(validContext, 'card').catch(() => [])
          // Exclude archived cards: the archive bin is invisible to the AI, so a
          // title that only exists in the archive must NOT block a fresh create.
          const existingCardsList = [...existingCards].filter(ci => ci.status !== 'archived')
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
            const createdCard = await createItem({
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
          <span className="truncate">
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
        <ViewOnKanbanButton onClick={() => setView('kanban')} />
      </div>
    </div>
  )
}
