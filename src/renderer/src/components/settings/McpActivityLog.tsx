import React, { useCallback, useEffect, useState } from 'react'
import { RotateCcw, History } from 'lucide-react'
import { useToast } from '../ui/Toast'
import type { McpActivityEntry } from '../../../../shared/mcpActivity'

/** Coarse on purpose, the useful question is "was this just now, or last week?". */
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
  // Captured once per load so every row in a render measures against the same
  // instant; reading Date.now() per row makes the list flicker between renders.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const rows = await window.electronAPI.mcp.listActivity(50)
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
    // An agent can write while this panel is open, so refresh on the same event
    // the rest of the UI uses to notice outside changes.
    const off = window.electronAPI.mcp.onDataChanged(() => load())
    return off
  }, [load])

  const handleUndo = async (entry: McpActivityEntry) => {
    setBusyId(entry.id)
    try {
      const result = await window.electronAPI.mcp.undoActivity(entry.id)
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
    return <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>Loading…</div>
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
        <History size={14} style={{ flexShrink: 0 }} />
        Nothing yet. Changes made by an external agent through MCP show up here.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      {entries.map(entry => {
        const undone = entry.undoneAt !== null
        return (
          <div
            key={entry.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              opacity: undone ? 0.55 : 1
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-base)',
                textDecoration: undone ? 'line-through' : 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {entry.summary}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '2px' }}>
                <code style={{ fontFamily: 'var(--font-mono)' }}>{entry.tool}</code>
                {entry.context ? ` · ${entry.context}` : ''}
                {` · ${relativeTime(entry.createdAt, now)}`}
                {undone ? ' · undone' : ''}
              </div>
            </div>

            {!undone && entry.undo && (
              <button
                className="btn-secondary"
                onClick={() => handleUndo(entry)}
                disabled={busyId === entry.id}
                aria-label={`Undo: ${entry.summary}`}
                title="Undo this change"
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <RotateCcw size={12} />
                Undo
              </button>
            )}
            {!undone && !entry.undo && (
              // Saying so beats an inert button: not every write has a reverse.
              <span style={{ fontSize: '11px', color: 'var(--color-text-faint)', flexShrink: 0 }}>
                not reversible
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
