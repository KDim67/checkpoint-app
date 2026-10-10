import React, { useEffect, useMemo, useRef, useState } from 'react'
import EntryChip, { SlotView } from './EntryChip'
import { cssVars, isEntryDrag, useCalendarActions } from './actions'
import { cellSlots, inTimeGrid, laneRow, placeTimed, weekdayNames, type DayContents } from './layout'
import { dayKey, minutesOf, sameDay, type CalendarEntry, type DropTarget } from '../../../../shared/calendar'
import type { CalendarDay } from '../../../../shared/dueDate'

interface Props {
  days: CalendarDay[]
  today: CalendarDay
  weekStart: number
  contents: Map<string, DayContents>
  entries: CalendarEntry[]
  now: number
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const DAY_MINUTES = 24 * 60
// where a working day starts; the grid opens here unless now is on screen
const OPEN_AT_HOUR = 7

const hourLabel = (h: number): string => new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })

/** minutes into the day at the pointer, from the column's own height */
function minutesAt(event: React.MouseEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect()
  return Math.max(0, Math.min(DAY_MINUTES - 1, ((event.clientY - rect.top) / rect.height) * DAY_MINUTES))
}

export default function WeekView({ days, today, weekStart, contents, entries, now }: Props): React.JSX.Element {
  const actions = useCalendarActions()
  const scroller = useRef<HTMLDivElement>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const names = weekdayNames(weekStart)
  const showsToday = days.some(d => sameDay(d, today))
  const allDayLanes = useMemo(
    () => laneRow(days, day => (contents.get(dayKey(day))?.entries ?? []).filter(e => !inTimeGrid(e))),
    [days, contents]
  )

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const hour = showsToday ? Math.max(0, new Date(now).getHours() - 1) : OPEN_AT_HOUR
    el.scrollTop = (el.scrollHeight / 24) * hour
    // once per week shown, not on every tick of the clock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.year, days[0]?.month, days[0]?.day])

  const dropZone = (key: string, target: (e: React.DragEvent<HTMLElement>) => DropTarget) => ({
    'data-drop': dropKey === key ? 'true' : undefined,
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!isEntryDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropKey !== key) setDropKey(key)
    },
    onDragLeave: () => setDropKey(k => (k === key ? null : k)),
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      setDropKey(null)
      actions.drop(target(e), e)
    }
  })

  return (
    <div className="cal-week" role="grid" aria-label="Week">
      <div className="cal-week-head" role="row">
        <div className="cal-gutter" />
        {days.map((day, i) => (
          <div key={dayKey(day)} className="cal-week-day" role="columnheader" data-today={sameDay(day, today) ? 'true' : undefined}>
            <span className="cal-weekday">{names[i]}</span>
            <span className="cal-day-number" aria-current={sameDay(day, today) ? 'date' : undefined}>{day.day}</span>
          </div>
        ))}
      </div>

      <div className="cal-week-allday" role="row">
        <div className="cal-gutter cal-gutter-label">All day</div>
        {days.map((day, column) => {
          const key = `allday:${dayKey(day)}`
          const cell = contents.get(dayKey(day))
          const { slots } = cellSlots(allDayLanes, column, Infinity)
          const logs = cell?.counts.log?.length ?? 0
          const commits = cell?.counts.commits?.length ?? 0
          return (
            <div
              key={key}
              role="gridcell"
              className="cal-allday-cell"
              aria-label={`All day, ${new Date(day.year, day.month, day.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}
              onClick={e => actions.add({ day, minutes: null, allDayRow: true }, { x: e.clientX, y: e.clientY })}
              {...dropZone(key, () => ({ day, minutes: null, allDayRow: true }))}
            >
              {slots.map((slot, lane) => (
                <SlotView key={slot.kind === 'start' ? `${slot.segment.entry.id}:${key}` : `slot:${lane}`} slot={slot} />
              ))}
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
            </div>
          )
        })}
      </div>

      <div className="cal-week-scroll" ref={scroller}>
        <div className="cal-week-grid">
          <div className="cal-gutter cal-hours" aria-hidden="true">
            {HOURS.map(h => <span key={h} className="cal-hour-label">{h === 0 ? '' : hourLabel(h)}</span>)}
          </div>
          {days.map(day => {
            const key = `time:${dayKey(day)}`
            const isToday = sameDay(day, today)
            return (
              <div
                key={key}
                role="gridcell"
                className="cal-day-column"
                aria-label={new Date(day.year, day.month, day.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                onClick={e => actions.add({ day, minutes: minutesAt(e), allDayRow: false }, { x: e.clientX, y: e.clientY })}
                {...dropZone(key, e => ({ day, minutes: minutesAt(e), allDayRow: false }))}
              >
                {placeTimed(entries, day).map(p => (
                  <EntryChip
                    key={`${p.entry.id}:${key}`}
                    entry={p.entry}
                    block
                    style={cssVars({
                      '--cal-top': `${(p.top / DAY_MINUTES) * 100}%`,
                      '--cal-height': `${(p.height / DAY_MINUTES) * 100}%`,
                      '--cal-left': `${(p.column / p.columns) * 100}%`,
                      '--cal-width': `${100 / p.columns}%`
                    })}
                  />
                ))}
                {isToday && (
                  <div className="cal-now" aria-hidden="true" style={cssVars({ '--cal-top': `${(minutesOf(now) / DAY_MINUTES) * 100}%` })} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
