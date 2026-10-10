import React from 'react'
import { MapPin } from 'lucide-react'
import Popover from './Popover'
import EntryChip from './EntryChip'
import { formatDuration, type CalendarEntry } from '../../../../shared/calendar'
import { DAY_MS } from '../../../../shared/dueDate'

const LAYER_NAME: Record<CalendarEntry['layer'], string> = {
  due: 'Due',
  repeats: 'Repeating task',
  renewals: 'Renewal',
  focus: 'Focus session',
  log: 'Log entry',
  commits: 'Commit',
  events: 'Event'
}

/** in words, the way the entry's own kind of thing is usually said */
function whenOf(entry: CalendarEntry): string {
  const day = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const time = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (entry.allDay) {
    // a whole day is midnight UTC; read in UTC so it names its own date everywhere
    const utc = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    return entry.days > 1 ? `${utc(entry.start)} to ${utc(entry.start + (entry.days - 1) * DAY_MS)}` : utc(entry.start)
  }
  if (entry.end && entry.end > entry.start) {
    const length = entry.layer === 'focus' ? `, ${formatDuration(entry.end - entry.start)}` : ''
    return `${day(entry.start)}, ${time(entry.start)} to ${time(entry.end)}${length}`
  }
  return `${day(entry.start)}, ${time(entry.start)}`
}

interface Props {
  entry: CalendarEntry
  at: { x: number; y: number }
  calendarName: string | null
  onClose: () => void
  /** for a repeat: its settings live in the Backlog */
  onOpenRepeats?: () => void
}

/** what the calendar knows about an entry that has no screen of its own to open */
export function EntryDetails({ entry, at, calendarName, onClose, onOpenRepeats }: Props): React.JSX.Element {
  return (
    <Popover at={at} label={entry.title} onClose={onClose}>
      <div className="cal-details">
        <div className="cal-popover-kicker">{entry.layer === 'events' && calendarName ? calendarName : LAYER_NAME[entry.layer]}</div>
        <div className="cal-popover-title">{entry.title}</div>
        <div className="text-sub">{whenOf(entry)}</div>
        {entry.detail && entry.layer === 'events' && (
          <div className="cal-details-line"><MapPin size={12} aria-hidden="true" />{entry.detail}</div>
        )}
        {entry.detail && entry.layer !== 'events' && <div className="text-sub">{entry.detail}</div>}
        {entry.notes && <p className="cal-details-notes">{entry.notes}</p>}
        {onOpenRepeats && (
          <div className="cal-popover-actions">
            <button type="button" className="btn-secondary" onClick={onOpenRepeats}>Open repeating tasks</button>
          </div>
        )}
      </div>
    </Popover>
  )
}

/** a whole day's list, for a cell that couldn't show everything */
export function DayList({ title, entries, at, onClose }: { title: string; entries: CalendarEntry[]; at: { x: number; y: number }; onClose: () => void }): React.JSX.Element {
  return (
    <Popover at={at} label={title} onClose={onClose}>
      <div className="cal-day-list">
        <div className="cal-popover-title">{title}</div>
        {entries.map(entry => <EntryChip key={entry.id} entry={entry} />)}
      </div>
    </Popover>
  )
}
