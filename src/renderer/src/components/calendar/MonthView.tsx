import React, { useMemo, useState } from 'react'
import { SlotView } from './EntryChip'
import { isEntryDrag, useCalendarActions } from './actions'
import { cellSlots, laneRow, weekdayNames, type DayContents } from './layout'
import { dayKey, formatDuration, sameDay } from '../../../../shared/calendar'
import type { CalendarDay } from '../../../../shared/dueDate'

interface Props {
  days: CalendarDay[]
  month: number
  today: CalendarDay
  weekStart: number
  contents: Map<string, DayContents>
}

/** past this the cell offers the rest in a list, so a busy day keeps the grid's shape */
const CHIPS_PER_DAY = 3

const longDate = (d: CalendarDay): string =>
  new Date(d.year, d.month, d.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

export default function MonthView({ days, month, today, weekStart, contents }: Props): React.JSX.Element {
  const actions = useCalendarActions()
  const [dropKey, setDropKey] = useState<string | null>(null)
  const names = weekdayNames(weekStart)

  // focus shows as one total here; the week draws each session
  const rows = useMemo(() => Array.from({ length: Math.ceil(days.length / 7) }, (_, r) =>
    laneRow(days.slice(r * 7, r * 7 + 7), day => (contents.get(dayKey(day))?.entries ?? []).filter(e => e.layer !== 'focus'))
  ), [days, contents])

  return (
    <div className="cal-month" role="grid" aria-label="Month">
      <div className="cal-month-head" role="row">
        {names.map(name => <div key={name} className="cal-weekday" role="columnheader">{name}</div>)}
      </div>
      <div className="cal-month-body">
        {days.map((day, i) => {
          const key = dayKey(day)
          const cell = contents.get(key)
          const { slots, hidden } = cellSlots(rows[Math.floor(i / 7)] ?? [], i % 7, CHIPS_PER_DAY)
          const logs = cell?.counts.log?.length ?? 0
          const commits = cell?.counts.commits?.length ?? 0
          const isToday = sameDay(day, today)
          return (
            <div
              key={key}
              role="gridcell"
              className="cal-month-cell"
              data-outside={day.month !== month ? 'true' : undefined}
              data-today={isToday ? 'true' : undefined}
              data-drop={dropKey === key ? 'true' : undefined}
              aria-label={longDate(day)}
              onClick={e => actions.add({ day, minutes: null, allDayRow: false }, { x: e.clientX, y: e.clientY })}
              onDragOver={e => {
                if (!isEntryDrag(e)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dropKey !== key) setDropKey(key)
              }}
              onDragLeave={() => setDropKey(k => (k === key ? null : k))}
              onDrop={e => {
                setDropKey(null)
                actions.drop({ day, minutes: null, allDayRow: false }, e)
              }}
            >
              <span className="cal-day-number" aria-current={isToday ? 'date' : undefined}>{day.day}</span>
              {slots.map((slot, lane) => (
                <SlotView key={slot.kind === 'start' ? `${slot.segment.entry.id}:${key}` : `slot:${lane}`} slot={slot} />
              ))}
              {cell && cell.focusMs > 0 && (
                <button type="button" className="cal-count" data-layer="focus" onClick={e => { e.stopPropagation(); actions.showDay(day, e.currentTarget) }}>
                  {formatDuration(cell.focusMs)} focus
                </button>
              )}
              {logs > 0 && (
                <button type="button" className="cal-count" data-layer="log" onClick={e => { e.stopPropagation(); actions.showDay(day, e.currentTarget) }}>
                  {logs === 1 ? '1 log entry' : `${logs} log entries`}
                </button>
              )}
              {commits > 0 && (
                <button type="button" className="cal-count" data-layer="commits" onClick={e => { e.stopPropagation(); actions.showDay(day, e.currentTarget) }}>
                  {commits === 1 ? '1 commit' : `${commits} commits`}
                </button>
              )}
              {hidden > 0 && (
                <button type="button" className="cal-more" onClick={e => { e.stopPropagation(); actions.showDay(day, e.currentTarget) }}>
                  {hidden} more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
