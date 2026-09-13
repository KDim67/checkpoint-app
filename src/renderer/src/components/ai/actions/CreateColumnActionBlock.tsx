import { useState, useEffect, useRef } from 'react'
import { Layout, RefreshCw, Columns, ArrowRight } from 'lucide-react'
import { useAppStore } from '../../../store/appStore'
import { withLock } from '../../../lib/asyncMutex'
import {
  boardConfigLockKey,
  readBoardConfigUnlocked,
  writeBoardConfigUnlocked,
  type ColumnConfig
} from '../../../lib/boardConfig'
import { toColorMode } from '../aiActionTypes'
import { normalizeColumnJson } from '../aiActionParse'
import { executedActionSignaturesSet, createdColsCacheMap, errorText } from './shared'

export default function CreateColumnActionBlock({ jsonString }: { jsonString: string }) {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const setView = useAppStore(s => s.setView)
  const [createdCol, setCreatedCol] = useState<ColumnConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  const normalized = normalizeColumnJson(jsonString)
  const name = normalized?.name || ''
  const signature = name ? `col::${activeWorkspace || 'default'}::${name.toLowerCase()}` : ''

  const cachedCol = signature ? createdColsCacheMap.get(signature) : null
  const colData = createdCol || cachedCol || (normalized ? { name: normalized.name, color: normalized.color, wipLimit: normalized.wipLimit } : null)

  // rebuilt from JSON each render, a ref keeps it out of the deps
  const parsedRef = useRef({ normalized, name, cachedCol })
  parsedRef.current = { normalized, name, cachedCol }

  useEffect(() => {
    let isMounted = true
    const { normalized, name, cachedCol } = parsedRef.current
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

        // kanban listens for this to reload
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
          <RefreshCw size={12} className="animate-spin" />
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
          <Columns size={14} className="no-shrink" />
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
