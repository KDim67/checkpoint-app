/**
 * Rewind: what you were doing last time you worked on this card. The join is in
 * `shared/rewind.ts`; this only presents it.
 *
 * Observations sit above the evidence, because the useful part is the sentence
 * handing back a fact you had forgotten, not the list of commits. The evidence
 * is grouped and collapsed with counts, since dumping forty window titles is
 * the same as showing nothing.
 *
 * The heading says "around then": this is inferred, not certain.
 */

import React, { useEffect, useState } from 'react'
import { History, ChevronRight, GitCommit as GitCommitIcon, Clipboard, MonitorSmartphone, StickyNote, AlertCircle } from 'lucide-react'
import { formatDuration, type Rewind, type Signal } from '../../../../shared/rewind'
import { loadRewind } from '../../lib/rewind'
import type { Item } from '../../../../shared/types'

/** Locale-aware, and short enough to sit on one line. */
function formatWhen(start: number, end: number): string {
  const d = new Date(start)
  const day = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
  const from = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const to = new Date(end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${from}–${to}`
}

function agoLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

interface GroupProps {
  icon: React.ReactNode
  label: string
  count: number
  children: React.ReactNode
}

/** A collapsed evidence group. States its size before it is opened. */
function Group({ icon, label, count, children }: GroupProps) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)'
        }}
      >
        <ChevronRight
          size={12}
          style={{
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform var(--duration-fast) var(--ease-default)',
            flexShrink: 0
          }}
        />
        <span className="row-6px-fixed">
          {icon}
          {label}
        </span>
        <span className="text-mono-micro">
          {count}
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: 'var(--space-2)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

const lineStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--color-text-muted)',
  lineHeight: 1.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

function Signals({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) return null
  return (
    <div className="col-6px">
      {signals.map(s => (
        <div
          key={s.kind}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderLeft: '2px solid var(--color-secondary)',
            borderRadius: 'var(--radius-sm)'
          }}
        >
          {/* An icon as well as the colour, so the emphasis is not carried by
              hue alone. */}
          <AlertCircle size={13} style={{ color: 'var(--color-secondary)', flexShrink: 0, marginTop: '1px' }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', lineHeight: 1.5 }}>
            {s.text}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function RewindPanel({ item }: { item: Item }) {
  const [state, setState] = useState<{ rewind: Rewind; unavailable: string[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadRewind(item)
      .then(res => { if (!cancelled) setState(res) })
      .catch(err => { if (!cancelled) { console.warn('[rewind] failed:', err); setState(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // Keyed on the id alone, deliberately. `item` is a new object on every
    // edit, and Rewind describes the past. Refetching five streams because the
    // user typed a character in the title would be work for an answer that
    // cannot have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
      <History size={14} className="text-accent" />
      <span style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-text-muted)'
      }}>
        Rewind
      </span>
    </div>
  )

  // Space is reserved at a fixed minimum so the card body does not jump when
  // the answer arrives.
  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '78px' }}>
      {header}
      {children}
    </div>
  )

  if (loading) {
    return shell(
      <div aria-live="polite" className="text-hint-faint">
        Looking back…
      </div>
    )
  }

  const rewind = state?.rewind
  if (!rewind || !rewind.sitting) {
    return shell(
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', lineHeight: 1.6 }}>
        No focus session has covered this card yet. Start the focus timer with this card
        selected, and Rewind will remember what you were doing, which windows were open,
        what you copied, and what you committed.
      </div>
    )
  }

  const { sitting, daysSince, windows, clipboard, commits, boardMoves, signals } = rewind

  return shell(
    <div className="col-md">

      {/* When, and for how long */}
      <div>
        <div className="text-item">
          {formatWhen(sitting.start, sitting.end)}
        </div>
        <div className="text-caption-sub">
          {formatDuration(sitting.durationMs)} focused across {sitting.sessionCount} session
          {sitting.sessionCount === 1 ? '' : 's'} · {agoLabel(daysSince)}
          {sitting.completed && ' · you ticked it off'}
        </div>
      </div>

      <Signals signals={signals} />

      {/* What was written down at the time beats anything inferred. */}
      {sitting.notes.length > 0 && (
        <div className="col-4px">
          {sitting.notes.map((note, i) => (
            <div
              key={i}
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
                lineHeight: 1.5,
                paddingLeft: 'var(--space-3)',
                borderLeft: '2px solid var(--color-surface-offset)'
              }}
            >
              “{note}”
            </div>
          ))}
        </div>
      )}

      <div>
        <Group icon={<MonitorSmartphone size={12} />} label="Open at the time" count={windows.length}>
          {windows.slice(0, 8).map((w, i) => (
            <div key={i} style={{ ...lineStyle, display: 'flex', gap: 'var(--space-2)' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.windowTitle}</span>
              <span style={{ color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                {formatDuration(w.durationMs)}
              </span>
            </div>
          ))}
        </Group>

        <Group icon={<GitCommitIcon size={12} />} label="Committed" count={commits.length}>
          {commits.map(c => (
            <div key={c.hash} style={lineStyle} title={c.message}>
              <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-faint)', marginRight: '6px' }}>
                {c.hash.slice(0, 7)}
              </code>
              {c.message.split('\n')[0]}
            </div>
          ))}
        </Group>

        <Group icon={<Clipboard size={12} />} label="Copied" count={clipboard.length}>
          {clipboard.slice(0, 6).map(c => (
            <div key={c.id} style={lineStyle} title={c.content}>
              {c.content.replace(/\s+/g, ' ').slice(0, 120)}
            </div>
          ))}
        </Group>

        <Group icon={<StickyNote size={12} />} label="On the board" count={boardMoves.length}>
          {boardMoves.map((m, i) => (
            <div key={i} style={lineStyle}>{m.text}</div>
          ))}
        </Group>
      </div>

      {/* Said plainly rather than left as a mysteriously thin panel. */}
      {state && state.unavailable.length > 0 && (
        <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
          Not included: {state.unavailable.join(', ')}. Turn these on in Settings for a fuller picture.
        </div>
      )}
    </div>
  )
}
