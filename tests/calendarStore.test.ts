import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getSetting, initDb } from '../src/main/db'
import {
  addSubscription,
  backoffMs,
  clearParsedCalendars,
  listSubscriptions,
  normalizeLink,
  refreshSubscriptions,
  removeSubscription,
  subscribedEntries,
  REFRESH_EVERY_MS,
  type StoreDeps
} from '../src/main/calendar/icalStore'
import { isSecretSetting } from '../src/main/secureSettings'

let home: string

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('./stubs/electron')>('./stubs/electron')
  return { ...actual, app: { ...actual.app, getPath: (name: string) => (name === 'home' ? home : `${home}/${name}`) } }
})

const ics = (title: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:${title}\r\nDTSTART:20261014T090000Z\r\nDTEND:20261014T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`

/** a feed that serves whatever the test says, on a public name and an internal one */
function feed() {
  let body: () => Response = () => new Response(ics('Dentist'))
  let clock = new Date(2026, 9, 10, 9).getTime()
  const requested: string[] = []
  const deps: StoreDeps = {
    fetch: (async (input: string | URL | Request) => {
      requested.push(String(input))
      return body()
    }) as typeof fetch,
    isPublicHost: async host => host !== 'intranet.example.com',
    now: () => clock
  }
  return {
    deps,
    requested,
    serve: (make: () => Response) => { body = make },
    advance: (ms: number) => { clock += ms }
  }
}

const OCT = [new Date(2026, 9, 1).getTime(), new Date(2026, 10, 1).getTime()] as const
const input = (url: string) => ({ name: 'Personal', url, color: '#336699', workspace: null })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'checkpoint-calendars-'))
  initDb(home)
  clearParsedCalendars()
})

afterEach(() => {
  closeDb()
  rmSync(home, { recursive: true, force: true })
})

describe('adding a calendar', () => {
  it('fetches it first, says how many events it has, and never hands the link back', async () => {
    const f = feed()
    const added = await addSubscription(input('webcal://cal.example.com/private-abc123/basic.ics'), f.deps)
    expect(added).toMatchObject({ ok: true, value: { events: 1, subscription: { name: 'Personal', host: 'cal.example.com', error: null } } })
    expect(f.requested).toStrictEqual(['https://cal.example.com/private-abc123/basic.ics'])
    expect(JSON.stringify(listSubscriptions())).not.toContain('private-abc123')
    expect(isSecretSetting('calendar_subscriptions')).toBe(true)
    expect(subscribedEntries(...OCT, null).entries.map(e => e.title)).toStrictEqual(['Dentist'])
  })

  it('refuses plain http, a private address, a page that isn\'t a calendar, and the same link twice', async () => {
    const f = feed()
    expect(await addSubscription(input('http://cal.example.com/a.ics'), f.deps)).toMatchObject({ ok: false, reason: expect.stringContaining('https://') })
    expect(await addSubscription(input('https://intranet.example.com/a.ics'), f.deps)).toMatchObject({ ok: false, reason: expect.stringContaining('public') })
    f.serve(() => new Response('<html>Sign in</html>'))
    expect(await addSubscription(input('https://cal.example.com/a.ics'), f.deps)).toMatchObject({ ok: false, reason: "That link didn't return a calendar." })
    f.serve(() => new Response(ics('Dentist')))
    await addSubscription(input('https://cal.example.com/a.ics'), f.deps)
    expect(await addSubscription(input('webcal://cal.example.com/a.ics'), f.deps)).toMatchObject({ ok: false, reason: 'That calendar is already added.' })
    expect(listSubscriptions()).toHaveLength(1)
  })

  it('reads webcal as https and nothing else', () => {
    expect(normalizeLink('webcal://a.example.com/x')?.href).toBe('https://a.example.com/x')
    expect(normalizeLink('ftp://a.example.com/x')).toBeNull()
    expect(normalizeLink('not a link')).toBeNull()
  })
})

describe('keeping a calendar current', () => {
  it('fetches again only when it is due, and says when something changed', async () => {
    const f = feed()
    await addSubscription(input('https://cal.example.com/a.ics'), f.deps)
    expect(await refreshSubscriptions(false, REFRESH_EVERY_MS, f.deps)).toBe(false)
    expect(f.requested).toHaveLength(1)
    f.advance(REFRESH_EVERY_MS)
    f.serve(() => new Response(ics('Dentist, moved')))
    expect(await refreshSubscriptions(false, REFRESH_EVERY_MS, f.deps)).toBe(true)
    expect(subscribedEntries(...OCT, null).entries.map(e => e.title)).toStrictEqual(['Dentist, moved'])
  })

  it('backs off after failures, keeps showing what it had, and says why', async () => {
    const f = feed()
    await addSubscription(input('https://cal.example.com/a.ics'), f.deps)
    f.serve(() => new Response('gone', { status: 404 }))
    await refreshSubscriptions(true, REFRESH_EVERY_MS, f.deps)
    await refreshSubscriptions(true, REFRESH_EVERY_MS, f.deps)
    const answer = subscribedEntries(...OCT, null)
    expect(answer.entries.map(e => e.title)).toStrictEqual(['Dentist'])
    expect(answer.problems[0]).toMatch(/answered 404; the link may have been reset\. Showing what it had/)
    // two failures mean an hour's wait before the next try
    const before = f.requested.length
    f.advance(REFRESH_EVERY_MS)
    await refreshSubscriptions(false, REFRESH_EVERY_MS, f.deps)
    expect(f.requested.length).toBe(before)
    expect(backoffMs(2)).toBe(2 * REFRESH_EVERY_MS)
    expect(backoffMs(10)).toBe(6 * 3_600_000)
  })

  it('reads from its cache after a restart, without fetching', async () => {
    const f = feed()
    await addSubscription(input('https://cal.example.com/a.ics'), f.deps)
    clearParsedCalendars()
    expect(subscribedEntries(...OCT, null).entries.map(e => e.title)).toStrictEqual(['Dentist'])
    expect(f.requested).toHaveLength(1)
  })

  it('shows a calendar given to one workspace only there', async () => {
    const f = feed()
    await addSubscription({ ...input('https://cal.example.com/a.ics'), workspace: 'home' }, f.deps)
    expect(subscribedEntries(...OCT, ['work']).entries).toStrictEqual([])
    expect(subscribedEntries(...OCT, ['home']).entries).toHaveLength(1)
    expect(subscribedEntries(...OCT, null).entries).toHaveLength(1)
  })

  it('forgets a removed calendar entirely, its cached copy too', async () => {
    const f = feed()
    const added = await addSubscription(input('https://cal.example.com/a.ics'), f.deps)
    const id = added.ok ? added.value.subscription.id : ''
    const cache = join(home, '.config', 'checkpoint', 'cache', 'calendars', `${id}.ics`)
    expect(existsSync(cache)).toBe(true)
    removeSubscription(id)
    expect(existsSync(cache)).toBe(false)
    expect(getSetting('calendar_subscriptions', null)).toStrictEqual([])
  })
})
