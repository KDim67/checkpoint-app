import React, { useCallback, useEffect, useState } from 'react'
import { RotateCcw, History } from 'lucide-react'
import { useToast } from '../ui/Toast'
import type { McpActivityEntry } from '../../../../shared/mcpActivity'
import * as mcpApi from '../../data/mcp'
import { SkeletonBlocks } from '../ui/Skeleton'

/** coarse on purpose: just now, or last week? */
function relativeTime(ms: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ms) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export default function McpActivityLog(): React.JSX.Element {
  const { toast } = useToast()
  const [entries, setEntries] = useState<McpActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  // one instant per load, Date.now() per row flickers
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const rows = await mcpApi.listActivity(50)
      setEntries(rows)
      setNow(Date.now())
    } catch (err) {
      console.error('Failed to load MCP activity:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // agents write while this is open, so refresh on the shared event
    const off = mcpApi.onDataChanged(() => load())
    return off
  }, [load])

  const handleUndo = async (entry: McpActivityEntry) => {
    setBusyId(entry.id)
    try {
      const result = await mcpApi.undoActivity(entry.id)
      if (result.ok) toast('Change undone')
      else toast(result.reason ?? 'Could not undo that change')
      await load()
    } catch (err) {
      console.error(err)
      toast('Could not undo that change')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <SkeletonBlocks label="Loading what agents changed" count={2} height="3rem" gap="var(--space-2)" />
  }

  if (entries.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)'
      }}>
        <History size={14} className="no-shrink" aria-hidden="true" />
        Nothing yet. What an agent changes through MCP shows here.
      </div>
    )
  }

  return (
    <ul className="settings-list" aria-label="Agent changes">
      {entries.map(entry => {
        const undone = entry.undoneAt !== null
        return (
          <li
            key={entry.id}
            className="settings-list-row"
            style={{ flexWrap: 'nowrap', opacity: undone ? 'var(--opacity-disabled)' : 1 }}
          >
            <div className="fill min-w-0">
              <div title={entry.summary} style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-base)',
                textDecoration: undone ? 'line-through' : 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {entry.summary}
              </div>
              <div className="text-caption-sub">
                <code className="mono">{entry.tool}</code>
                {entry.context ? ` · ${entry.context}` : ''}
                {` · ${relativeTime(entry.createdAt, now)}`}
                {undone ? ' · undone' : ''}
              </div>
            </div>

            {!undone && entry.undo && (
              <button
                type="button"
                className="btn-secondary btn-small"
                onClick={() => handleUndo(entry)}
                disabled={busyId === entry.id}
                aria-label={`Undo: ${entry.summary}`}
                title="Undo this change"
                style={{ flexShrink: 0 }}
              >
                <RotateCcw size={12} aria-hidden="true" />
                Undo
              </button>
            )}
            {!undone && !entry.undo && (
              // say so instead of an inert button, not every write reverses
              <span className="text-sub" style={{ flexShrink: 0, marginTop: 0 }}>
                Can't be undone
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
