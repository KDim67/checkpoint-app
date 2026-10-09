import { describe, it, expect } from 'vitest'
import { eventsBetween, parseCalendar } from '../src/main/calendar/ical'

const source = { id: 'cal', color: '#336699', workspace: null }
const wrap = (body: string): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body}END:VCALENDAR\r\n`
const iso = (ms: number): string => new Date(ms).toISOString()

const between = (ics: string, from: string, to: string) =>
  eventsBetween(parseCalendar(wrap(ics)), source, Date.parse(from), Date.parse(to))

const NEW_YORK = `BEGIN:VTIMEZONE\r
TZID:America/New_York\r
BEGIN:DAYLIGHT\r
TZOFFSETFROM:-0500\r
TZOFFSETTO:-0400\r
TZNAME:EDT\r
DTSTART:19700308T020000\r
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r
END:DAYLIGHT\r
BEGIN:STANDARD\r
TZOFFSETFROM:-0400\r
TZOFFSETTO:-0500\r
TZNAME:EST\r
DTSTART:19701101T020000\r
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r
END:STANDARD\r
END:VTIMEZONE\r
`

describe('reading a subscribed calendar', () => {
  it('reads a single timed event with its place and description', () => {
    const [e] = between(`BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Dentist\r\nLOCATION:High St\r\nDESCRIPTION:Bring the form\r\nDTSTART:20261014T090000Z\r\nDTEND:20261014T100000Z\r\nEND:VEVENT\r\n`, '2026-10-01', '2026-11-01')
    expect(e).toMatchObject({ title: 'Dentist', detail: 'High St', notes: 'Bring the form', allDay: false, color: '#336699', movable: false, layer: 'events' })
    expect(iso(e.start)).toBe('2026-10-14T09:00:00.000Z')
    expect(iso(e.end as number)).toBe('2026-10-14T10:00:00.000Z')
  })

  it('keeps a whole-day event in the due-date encoding, with how many days it covers', () => {
    const [e] = between(`BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Conference\r\nDTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261015\r\nEND:VEVENT\r\n`, '2026-10-01', '2026-11-01')
    expect(e).toMatchObject({ allDay: true, days: 3, start: Date.UTC(2026, 9, 12), end: null })
  })

  it('walks a weekly repeat, skipping its excluded dates', () => {
    const entries = between(`BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Standup\r\nDTSTART:20261005T100000Z\r\nDTEND:20261005T101500Z\r\nRRULE:FREQ=WEEKLY;COUNT=5\r\nEXDATE:20261012T100000Z\r\nEND:VEVENT\r\n`, '2026-10-01', '2026-12-01')
    expect(entries.map(e => iso(e.start))).toStrictEqual([
      '2026-10-05T10:00:00.000Z', '2026-10-19T10:00:00.000Z', '2026-10-26T10:00:00.000Z', '2026-11-02T10:00:00.000Z'
    ])
  })

  it('puts a moved occurrence where it was moved to, with its own title', () => {
    const entries = between(
      `BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Review\r\nDTSTART:20261005T100000Z\r\nDTEND:20261005T110000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\n` +
      `BEGIN:VEVENT\r\nUID:d\r\nRECURRENCE-ID:20261012T100000Z\r\nSUMMARY:Review, moved\r\nDTSTART:20261013T150000Z\r\nDTEND:20261013T160000Z\r\nEND:VEVENT\r\n`,
      '2026-10-01', '2026-11-01'
    )
    expect(entries.map(e => [iso(e.start), e.title])).toStrictEqual([
      ['2026-10-05T10:00:00.000Z', 'Review'],
      ['2026-10-13T15:00:00.000Z', 'Review, moved'],
      ['2026-10-19T10:00:00.000Z', 'Review']
    ])
  })

  it('keeps a time zone\'s local time across its clock change', () => {
    const entries = between(`${NEW_YORK}BEGIN:VEVENT\r\nUID:e\r\nSUMMARY:Call\r\nDTSTART;TZID=America/New_York:20260305T090000\r\nDTEND;TZID=America/New_York:20260305T093000\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nEND:VEVENT\r\n`, '2026-03-01', '2026-03-20')
    // 9am in New York both weeks: before the change it is 14:00 UTC, after it 13:00
    expect(entries.map(e => iso(e.start))).toStrictEqual(['2026-03-05T14:00:00.000Z', '2026-03-12T13:00:00.000Z'])
  })

  it('leaves out what was cancelled, and what falls outside the range', () => {
    const entries = between(
      `BEGIN:VEVENT\r\nUID:f\r\nSUMMARY:Off\r\nSTATUS:CANCELLED\r\nDTSTART:20261014T090000Z\r\nEND:VEVENT\r\n` +
      `BEGIN:VEVENT\r\nUID:g\r\nSUMMARY:Later\r\nDTSTART:20270101T090000Z\r\nEND:VEVENT\r\n`,
      '2026-10-01', '2026-11-01'
    )
    expect(entries).toStrictEqual([])
  })

  it('finds an occurrence moved into the range from after it', () => {
    const entries = between(
      `BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:Monthly\r\nDTSTART:20260905T100000Z\r\nRRULE:FREQ=MONTHLY;COUNT=4\r\nEND:VEVENT\r\n` +
      `BEGIN:VEVENT\r\nUID:h\r\nRECURRENCE-ID:20261105T100000Z\r\nSUMMARY:Monthly, early\r\nDTSTART:20261028T100000Z\r\nEND:VEVENT\r\n`,
      '2026-10-01', '2026-11-01'
    )
    expect(entries.map(e => e.title)).toStrictEqual(['Monthly', 'Monthly, early'])
  })

  it('refuses a file that is not a calendar', () => {
    expect(() => parseCalendar('<html>Sign in</html>')).toThrow()
    expect(() => parseCalendar('BEGIN:VCARD\r\nVERSION:4.0\r\nEND:VCARD\r\n')).toThrow()
  })
})
