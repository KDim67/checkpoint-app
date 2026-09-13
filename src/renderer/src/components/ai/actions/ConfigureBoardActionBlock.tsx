import React, { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../../store/appStore'
import { withLock } from '../../../lib/asyncMutex'
import {
  boardConfigLockKey,
  readBoardConfigUnlocked,
  writeBoardConfigUnlocked
} from '../../../lib/boardConfig'
import { applyConfigOps, normalizeConfigUpdate, type ConfigOperation } from '../../../lib/boardConfigOps'
import { faultTolerantParseJSON } from '../aiActionParse'
import { bulkUpdateItems, readItems, updateItem } from '../../../data/items'
import { executedActionSignaturesSet } from './shared'

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
export default function ConfigureBoardActionBlock({ jsonString, dedupeKey }: { jsonString: string; dedupeKey?: string }) {
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

  // Rebuilt from the JSON on every render, so read through a ref rather than
  // listed: listing it would run the effect on every render, and cancel the
  // edit already in flight.
  const parsedRef = useRef(operations)
  parsedRef.current = operations

  useEffect(() => {
    const operations = parsedRef.current
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
            const page = await readItems(context, 'card')
            for (const move of applied.cardMoves) {
              const affected = page.filter(i => i.status === move.fromColumn)
              if (affected.length === 0) continue
              movedCards.push(...affected.map(i => ({ id: i.id, status: move.fromColumn })))
              await bulkUpdateItems({
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
        await updateItem(card.id, { status: card.status }).catch(() => {})
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
        <strong className="text-base">
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
