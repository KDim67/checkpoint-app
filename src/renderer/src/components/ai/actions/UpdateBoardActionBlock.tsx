import { useState, useEffect } from 'react'
import CodeBlock from '../../ui/CodeBlock'
import { CheckCircle2, Layout, RefreshCw, ArrowRight } from 'lucide-react'
import { useAppStore } from '../../../store/appStore'
import { withLock } from '../../../lib/asyncMutex'
import { readBoardConfigUnlocked, type ColumnConfig } from '../../../lib/boardConfig'
import { normalizeUpdate } from '../boardEnrich'
import type { UpdateOperation } from '../boardEnrich'
import type { Item } from '@shared/types'
import { faultTolerantParseJSON } from '../aiActionParse'
import { readItems, updateItem } from '../../../data/items'
import { executedActionSignaturesSet, type UpdateOutcome, executedUpdateOutcomesMap, errorText } from './shared'

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

export default function UpdateBoardActionBlock({ jsonString, dedupeKey }: { jsonString: string; dedupeKey?: string }) {
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
            readItems(validContext, 'task').catch(() => []),
            readItems(validContext, 'card').catch(() => [])
          ])
          // Kept separate on purpose: the Kanban board renders ONLY 'card'
          // items, so board edits must prefer cards. A Backlog task with the
          // same title must never shadow the visible card (that "moved"
          // something invisible and left the board looking untouched).
          const cardItems = (cardsRes || []).filter(i => i.status !== 'archived')
          const taskItems = (tasksRes || []).filter(i => i.status !== 'archived')

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
                await updateItem(item.id, { status: col.id })
                inverse.push({ id: item.id, patch: { status: item.status } })
                applied.push(`Moved "${item.title}" → ${col.name}`)
                item.status = col.id
              } else if (op.op === 'set_priority') {
                if (item.priority === op.priority) { noops++; continue }
                await updateItem(item.id, { priority: op.priority })
                inverse.push({ id: item.id, patch: { priority: item.priority } })
                applied.push(`"${item.title}" priority → ${op.priority === 3 ? 'High' : op.priority === 2 ? 'Medium' : 'Low'}`)
                item.priority = op.priority
              } else if (op.op === 'retitle') {
                if (item.title.trim() === (op.newTitle || '').trim()) { noops++; continue }
                await updateItem(item.id, { title: op.newTitle })
                inverse.push({ id: item.id, patch: { title: item.title } })
                applied.push(`Renamed "${item.title}" → "${op.newTitle}"`)
                item.title = op.newTitle
              } else if (op.op === 'update_body') {
                await updateItem(item.id, { body: op.newBody })
                inverse.push({ id: item.id, patch: { body: item.body || '' } })
                applied.push(`Updated description of "${item.title}"`)
              } else if (op.op === 'set_due_date') {
                const dueMs = op.due ? Date.parse(op.due) : null
                if (op.due && Number.isNaN(dueMs)) { failed.push(`set due date "${item.title}": unparseable date "${op.due}"`); continue }
                if ((item.due_at ?? null) === dueMs) { noops++; continue }
                await updateItem(item.id, { due_at: dueMs })
                inverse.push({ id: item.id, patch: { due_at: item.due_at ?? null } })
                applied.push(dueMs
                  ? `"${item.title}" due → ${new Date(dueMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`
                  : `Cleared due date of "${item.title}"`)
                item.due_at = dueMs
              } else if (op.op === 'archive') {
                await updateItem(item.id, { status: 'archived' })
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
        await updateItem(inv.id, inv.patch).catch(() => {})
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
