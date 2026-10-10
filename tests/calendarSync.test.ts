import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '../src/main/db'
import {
  addSubscription,
  clearParsedCalendars,
  forgetSubscription,
  listSubscriptions,
  mergeSyncedSubscriptions,
  removeSubscription,
  subscriptionsForSync,
  updateSubscription,
  type StoreDeps
} from '../src/main/calendar/icalStore'
import { SyncService } from '../src/main/syncService'

// two computers, each its own database and home; local sync carries links, nothing else does

let home: string
const homes: Record<'A' | 'B', string> = { A: '', B: '' }

vi.mock('electron', async () => {
  const actual = await vi.importActual<typeof import('./stubs/electron')>('./stubs/electron')
  return { ...actual, app: { ...actual.app, getPath: (name: string) => (name === 'home' ? home : `${home}/${name}`) } }
})

const service = new SyncService()

const on = (machine: 'A' | 'B'): void => {
  closeDb()
  home = homes[machine]
  initDb(home)
}

/** one local-network session: the host's state lands on the client, then the client's goes back */
function syncLocal(host: 'A' | 'B', client: 'A' | 'B'): void {
  on(host)
  const fromHost = service.getDatabasePayload({ withSecrets: true })
  on(client)
  service.applyDatabasePayload(fromHost, { withSecrets: true })
  const fromClient = service.getDatabasePayload({ withSecrets: true })
  on(host)
  service.applyDatabasePayload(fromClient, { withSecrets: true })
}

const deps: StoreDeps = {
  fetch: (async () => new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')) as typeof fetch,
  isPublicHost: async () => true,
  now: () => Date.now()
}

const LINK = 'https://calendar.example.com/private-3f9a/basic.ics'

async function addOnA(name = 'Work'): Promise<string> {
  on('A')
  const added = await addSubscription({ name, url: LINK, color: '#1e45fc', workspace: null }, deps)
  if (!added.ok) throw new Error(added.reason)
  return added.value.subscription.id
}

beforeEach(() => {
  homes.A = mkdtempSync(join(tmpdir(), 'checkpoint-cal-a-'))
  homes.B = mkdtempSync(join(tmpdir(), 'checkpoint-cal-b-'))
  clearParsedCalendars()
})

afterEach(() => {
  closeDb()
  for (const dir of Object.values(homes)) rmSync(dir, { recursive: true, force: true })
})

describe('calendars you subscribe to, between your computers', () => {
  it('arrive on the other computer over local sync, link and all', async () => {
    const id = await addOnA()
    syncLocal('A', 'B')
    on('B')
    expect(listSubscriptions().map(s => [s.id, s.name, s.host])).toStrictEqual([[id, 'Work', 'calendar.example.com']])
    expect(subscriptionsForSync()[0].url).toBe(LINK)
  })

  it('never travel in what internet sync or the screen can see or send', async () => {
    const id = await addOnA()
    expect(service.getDatabasePayload()).not.toHaveProperty('calendar_subscriptions')
    const withLinks = service.getDatabasePayload({ withSecrets: true })
    on('B')
    service.applyDatabasePayload(withLinks)
    expect(listSubscriptions()).toStrictEqual([])
    expect(withLinks.calendar_subscriptions?.[0].id).toBe(id)
  })

  it('take the newest change from either side', async () => {
    const id = await addOnA()
    syncLocal('A', 'B')
    on('B')
    await new Promise(resolve => setTimeout(resolve, 5))
    updateSubscription(id, { name: 'Work, renamed on B' })
    syncLocal('B', 'A')
    on('A')
    expect(listSubscriptions()[0].name).toBe('Work, renamed on B')
  })

  it('stay removed once removed on one computer, whichever syncs next', async () => {
    const id = await addOnA()
    syncLocal('A', 'B')
    on('A')
    removeSubscription(id)
    syncLocal('B', 'A')
    on('B')
    expect(listSubscriptions()).toStrictEqual([])
    syncLocal('A', 'B')
    on('A')
    expect(listSubscriptions()).toStrictEqual([])
  })

  it('refuse an id that could name a file outside the cache, and a link that is not https', () => {
    on('B')
    const base = { name: 'Bad', color: '#1e45fc', workspace: null, addedAt: 1, updatedAt: 2 }
    expect(mergeSyncedSubscriptions([{ ...base, id: '../../outside', url: LINK }], new Set())).toBe(0)
    expect(mergeSyncedSubscriptions([{ ...base, id: '0f8fad5b-d9cb-469f-a165-70867728950e', url: 'http://calendar.example.com/x.ics' }], new Set())).toBe(0)
    expect(() => forgetSubscription('../../outside')).not.toThrow()
    expect(listSubscriptions()).toStrictEqual([])
  })
})
