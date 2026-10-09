/** reads an iCalendar file into entries for a range; repeats, exceptions and time zones are ical.js's, never hand-rolled */

import ICAL from 'ical.js'
import { DAY_MS } from '../../shared/dueDate'
import type { CalendarEntry } from '../../shared/calendar'

export interface CalendarSource {
  id: string
  color: string
  workspace: string | null
}

/** parsed once per download; expanding for a range is cheap, parsing a big file is not */
export interface ParsedCalendar {
  events: InstanceType<typeof ICAL.Event>[]
  count: number
}

/** a step of a daily repeat from years back still has to be walked, so the walk has a ceiling */
const MAX_STEPS = 20_000
const MAX_ENTRIES = 2000
/** how far a single occurrence can be moved and still be found */
const MOVED_MARGIN = 31 * DAY_MS

export function parseCalendar(text: string): ParsedCalendar {
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name !== 'vcalendar') throw new Error('It is not an iCalendar file.')
  // registered globally by name; feeds that share a name share the definition, which is the same zone
  for (const zone of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(zone)

  const primaries = new Map<string, InstanceType<typeof ICAL.Event>>()
  const exceptions: InstanceType<typeof ICAL.Event>[] = []
  const events: InstanceType<typeof ICAL.Event>[] = []
  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component)
    if (event.isRecurrenceException()) exceptions.push(event)
    else {
      events.push(event)
      if (event.uid) primaries.set(event.uid, event)
    }
  }
  for (const exception of exceptions) {
    const primary = primaries.get(exception.uid)
    // a moved occurrence whose series isn't in the file still happens
    if (primary) primary.relateException(exception)
    else events.push(exception)
  }
  return { events, count: events.length }
}

const cancelled = (event: InstanceType<typeof ICAL.Event>): boolean =>
  String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED'

type Time = InstanceType<typeof ICAL.Time>

/** a whole day in the due-date encoding, midnight UTC of its date */
const wholeDay = (t: Time): number => Date.UTC(t.year, t.month - 1, t.day)

function entry(source: CalendarSource, event: InstanceType<typeof ICAL.Event>, start: Time, end: Time | null): CalendarEntry {
  const allDay = start.isDate
  const startMs = allDay ? wholeDay(start) : start.toJSDate().getTime()
  // DTEND is exclusive, and an event with none lasts its own day or its own instant
  const endMs = end ? (allDay ? wholeDay(end) : end.toJSDate().getTime()) : null
  const days = allDay && endMs !== null ? Math.max(1, Math.round((endMs - startMs) / DAY_MS)) : 1
  const notes = event.description?.trim()
  return {
    id: `event:${source.id}:${event.uid}:${startMs}`,
    layer: 'events',
    title: event.summary?.trim() || '(No title)',
    start: startMs,
    end: allDay ? null : endMs,
    allDay,
    days,
    workspace: source.workspace,
    color: source.color,
    movable: false,
    state: null,
    ref: { kind: 'event', calendarId: source.id, uid: event.uid },
    detail: event.location?.trim() || null,
    ...(notes ? { notes: notes.slice(0, 4000) } : {})
  }
}

/** the end a range check uses: an all-day event to the end of its last day, a timed one to its end */
function finish(e: CalendarEntry): number {
  return e.allDay ? e.start + e.days * DAY_MS : Math.max(e.end ?? e.start, e.start)
}

/** occurrences overlapping the range, widened a day so whole days near midnight aren't lost */
export function eventsBetween(parsed: ParsedCalendar, source: CalendarSource, from: number, to: number): CalendarEntry[] {
  const lo = from - DAY_MS
  const hi = to + DAY_MS
  const out: CalendarEntry[] = []
  for (const event of parsed.events) {
    if (out.length >= MAX_ENTRIES) break
    if (cancelled(event)) continue
    if (!event.isRecurring()) {
      const e = entry(source, event, event.startDate, event.endDate ?? null)
      if (e.start < hi && finish(e) > lo) out.push(e)
      continue
    }
    const walk = event.iterator()
    for (let step = 0; step < MAX_STEPS && out.length < MAX_ENTRIES; step++) {
      const next = walk.next()
      if (!next) break
      // judged by where the series put it, so one moved into the range from later still counts
      const original = next.isDate ? wholeDay(next) : next.toJSDate().getTime()
      if (original >= hi + MOVED_MARGIN) break
      const details = event.getOccurrenceDetails(next)
      const occurrence = details.item ?? event
      if (cancelled(occurrence)) continue
      const e = entry(source, occurrence, details.startDate, details.endDate ?? null)
      if (e.start < hi && finish(e) > lo) out.push(e)
    }
  }
  return out
}
