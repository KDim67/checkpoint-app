import React from 'react'
import { CalendarClock, GitCommitHorizontal, NotebookPen, Repeat, Timer } from 'lucide-react'
import { DRAG_TYPE, cssVars, useCalendarActions } from './actions'
import type { CalendarEntry } from '../../../../shared/calendar'

const ICONS: Partial<Record<CalendarEntry['layer'], React.ReactNode>> = {
  repeats: <Repeat size={11} aria-hidden="true" />,
  renewals: <CalendarClock size={11} aria-hidden="true" />,
  focus: <Timer size={11} aria-hidden="true" />,
  log: <NotebookPen size={11} aria-hidden="true" />,
  commits: <GitCommitHorizontal size={11} aria-hidden="true" />
}

const STATE_WORD: Partial<Record<NonNullable<CalendarEntry['state']>, string>> = {
  late: 'late',
  done: 'done',
  ghost: 'coming up',
  warning: 'warning starts'
}

/** a time for a timed entry; a whole day says nothing */
const timeOf = (entry: CalendarEntry): string | null =>
  entry.allDay ? null : new Date(entry.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

interface Props {
  entry: CalendarEntry
  /** the week grid lays chips out as blocks of time */
  block?: boolean
  style?: React.CSSProperties
}

/** one entry: its colour, its state in form as well as word, draggable when its date is the calendar's to change */
export default function EntryChip({ entry, block = false, style }: Props): React.JSX.Element {
  const actions = useCalendarActions()
  const time = timeOf(entry)
  const workspace = actions.workspaceLabel(entry)
  const state = entry.state ? STATE_WORD[entry.state] : undefined
  const label = [entry.title, time, entry.detail, workspace, state].filter(Boolean).join(', ')

  return (
    <button
      type="button"
      className={block ? 'cal-chip cal-block' : 'cal-chip'}
      data-layer={entry.layer}
      data-state={entry.state ?? undefined}
      draggable={entry.movable}
      title={label}
      aria-label={label}
      style={{ ...cssVars({ '--cal-chip-color': actions.colorOf(entry) }), ...style }}
      onClick={e => {
        e.stopPropagation()
        actions.open(entry, e.currentTarget)
      }}
      onDragStart={e => {
        if (!entry.movable) return
        e.dataTransfer.setData(DRAG_TYPE, entry.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {ICONS[entry.layer]}
      {time && !block && <span className="cal-chip-time">{time}</span>}
      <span className="cal-chip-title">{entry.title}</span>
      {block && time && <span className="cal-chip-time">{time}</span>}
      {entry.state === 'late' && <span className="cal-chip-badge">late</span>}
    </button>
  )
}
