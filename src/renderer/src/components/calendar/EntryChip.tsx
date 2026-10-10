import React from 'react'
import { CalendarClock, GitCommitHorizontal, NotebookPen, Repeat, Timer } from 'lucide-react'
import { DRAG_TYPE, cssVars, useCalendarActions } from './actions'
import type { Slot } from './layout'
import { sameDay, type CalendarEntry, type Nudge } from '../../../../shared/calendar'
import { DAY_MS, localDayOf } from '../../../../shared/dueDate'

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

const NUDGES: Record<string, Nudge> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/** a time for a timed entry; a whole day says nothing */
const timeOf = (entry: CalendarEntry): string | null =>
  entry.allDay ? null : new Date(entry.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** where a multi-day entry ends, since a week can cut its bar short */
function untilOf(entry: CalendarEntry): string | null {
  if (entry.allDay) {
    if (entry.days <= 1) return null
    // a whole day is midnight UTC; read in UTC so it names its own date everywhere
    return `until ${new Date(entry.start + (entry.days - 1) * DAY_MS).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`
  }
  // an end at midnight belongs to the day before
  if (entry.end === null || sameDay(localDayOf(entry.start), localDayOf(entry.end - 1))) return null
  return `until ${new Date(entry.end).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
}

interface Props {
  entry: CalendarEntry
  /** the week grid lays chips out as blocks of time */
  block?: boolean
  /** days a bar runs across in its row */
  span?: number
  continuesBefore?: boolean
  continuesAfter?: boolean
  style?: React.CSSProperties
}

/** one entry: its colour, its state in form as well as word, movable by drag or Alt and the arrow keys when its date is the calendar's to change */
export default function EntryChip({ entry, block = false, span = 1, continuesBefore = false, continuesAfter = false, style }: Props): React.JSX.Element {
  const actions = useCalendarActions()
  const time = timeOf(entry)
  const workspace = actions.workspaceLabel(entry)
  const state = entry.state ? STATE_WORD[entry.state] : undefined
  const label = [entry.title, time, untilOf(entry), entry.detail, workspace, state].filter(Boolean).join(', ')

  return (
    <button
      type="button"
      className={block ? 'cal-chip cal-block' : 'cal-chip'}
      data-entry-id={entry.id}
      data-layer={entry.layer}
      data-state={entry.state ?? undefined}
      data-span={span > 1 ? span : undefined}
      data-continues-before={continuesBefore ? 'true' : undefined}
      data-continues-after={continuesAfter ? 'true' : undefined}
      draggable={entry.movable}
      title={entry.movable ? `${label}\nDrag it, or press Alt and an arrow key, to move it` : label}
      aria-label={label}
      aria-keyshortcuts={entry.movable ? 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown' : undefined}
      style={{ ...cssVars({ '--cal-chip-color': actions.colorOf(entry), '--cal-span': String(span) }), ...style }}
      onClick={e => {
        e.stopPropagation()
        actions.open(entry, e.currentTarget)
      }}
      onKeyDown={e => {
        const nudge = NUDGES[e.key]
        if (!entry.movable || !nudge || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
        e.preventDefault()
        e.stopPropagation()
        actions.nudge(entry, nudge, block)
      }}
      onDragStart={e => {
        if (!entry.movable) return
        e.dataTransfer.setData(DRAG_TYPE, entry.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {!continuesBefore && ICONS[entry.layer]}
      {time && !block && !continuesBefore && <span className="cal-chip-time">{time}</span>}
      <span className="cal-chip-title">{entry.title}</span>
      {block && time && <span className="cal-chip-time">{time}</span>}
      {entry.state === 'late' && <span className="cal-chip-badge">late</span>}
    </button>
  )
}

/** a lane in a cell: the entry that starts there, or room kept for a bar passing over */
export function SlotView({ slot }: { slot: Slot }): React.JSX.Element {
  if (slot.kind !== 'start') return <div className="cal-slot" aria-hidden="true" />
  const { entry, span, continuesBefore, continuesAfter } = slot.segment
  return <EntryChip entry={entry} span={span} continuesBefore={continuesBefore} continuesAfter={continuesAfter} />
}
