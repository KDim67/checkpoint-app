import React from 'react'
import EntryChip from './EntryChip'
import { AGENDA_DAYS, type DayContents } from './layout'
import { dayKey, sameDay } from '../../../../shared/calendar'
import type { CalendarDay } from '../../../../shared/dueDate'

interface Props {
  days: CalendarDay[]
  today: CalendarDay
  contents: Map<string, DayContents>
}

/** the days ahead as a list, the quickest to scan; empty days are left out */
export default function AgendaView({ days, today, contents }: Props): React.JSX.Element {
  const filled = days
    .map(day => {
      const cell = contents.get(dayKey(day))
      const all = [...(cell?.entries ?? []), ...(cell?.counts.log ?? []), ...(cell?.counts.commits ?? [])]
      return { day, entries: all }
    })
    .filter(d => d.entries.length > 0)

  if (filled.length === 0) {
    return <div className="cal-agenda-empty">Nothing in the {AGENDA_DAYS} days from here.</div>
  }

  return (
    <ol className="cal-agenda" aria-label="Agenda">
      {filled.map(({ day, entries }) => (
        <li key={dayKey(day)} className="cal-agenda-day" data-today={sameDay(day, today) ? 'true' : undefined}>
          <h3 className="cal-agenda-date">
            {sameDay(day, today) ? 'Today, ' : ''}
            {new Date(day.year, day.month, day.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          <div className="cal-agenda-entries">
            {entries.map(entry => <EntryChip key={`${entry.id}:${dayKey(day)}`} entry={entry} />)}
          </div>
        </li>
      ))}
    </ol>
  )
}
