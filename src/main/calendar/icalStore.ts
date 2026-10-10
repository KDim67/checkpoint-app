/** calendars you subscribe to by private link: stored encrypted on this machine, fetched through the guard, cached for offline */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getSetting, recordTombstone, setSetting } from '../db'
import { ensureDir, getCalendarCacheDir } from '../paths'
import { guardedFetch, readCapped } from '../guardedFetch'
import { isPublicHost } from '../publicAddress'
import { eventsBetween, parseCalendar, type ParsedCalendar } from './ical'
import type { CalendarEntry } from '../../shared/calendar'
import type { CalendarSubscription, SubscriptionInput } from '../../shared/calendarApi'
import type { SyncedCalendarSubscription } from '../../shared/types'

/** secret: the link is all anyone needs to read the calendar */
export const SUBSCRIPTIONS_KEY = 'calendar_subscriptions'
const STATE_KEY = 'calendar_fetch_state'

const FETCH_TIMEOUT_MS = 30_000
const MAX_BYTES = 5 * 1024 * 1024
export const REFRESH_EVERY_MS = 30 * 60_000
const MAX_BACKOFF_MS = 6 * 60 * 60_000
const MAX_SUBSCRIPTIONS = 30
/** the table name removals are recorded under, for sync */
export const SUBSCRIPTIONS_TABLE = 'calendar_subscriptions'
// an id names its cache file, so one from another computer must be exactly the shape this one makes
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Stored = SyncedCalendarSubscription

interface FetchState {
  lastOk: number | null
  lastAttempt: number | null
  error: string | null
  failures: number
}

export interface StoreDeps {
  fetch: typeof fetch
  isPublicHost: (hostname: string) => Promise<boolean>
  now: () => number
}

const real: StoreDeps = { fetch: (input, init) => fetch(input, init), isPublicHost: host => isPublicHost(host), now: () => Date.now() }

/** one parse per download, keyed by the text it came from */
const parsed = new Map<string, { text: string; calendar: ParsedCalendar }>()

const HEX = /^#[0-9a-f]{6}$/i

function readStored(): Stored[] {
  const raw = getSetting<unknown>(SUBSCRIPTIONS_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is Stored =>
    !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.url === 'string' && typeof s.name === 'string')
    .map(s => {
      const addedAt = typeof s.addedAt === 'number' ? s.addedAt : 0
      return {
        ...s,
        color: HEX.test(s.color) ? s.color : '#535e85',
        workspace: typeof s.workspace === 'string' ? s.workspace : null,
        addedAt,
        // saved before sync carried calendars: as new as when it was added
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : addedAt
      }
    })
}

const writeStored = (list: Stored[]): void => setSetting(SUBSCRIPTIONS_KEY, list)

function readState(): Record<string, FetchState> {
  const raw = getSetting<unknown>(STATE_KEY, {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, FetchState>) : {}
}

function writeState(id: string, state: FetchState | null): void {
  const all = readState()
  if (state) all[id] = state
  else delete all[id]
  setSetting(STATE_KEY, all)
}

const cacheFile = (id: string): string => join(getCalendarCacheDir(), `${id}.ics`)

/** webcal is the same feed over https; anything that isn't https is refused */
export function normalizeLink(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    return null
  }
  return url.protocol === 'https:' ? url : null
}

/** the wait after a run of failures: half an hour, doubling, never more than six */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(MAX_BACKOFF_MS, REFRESH_EVERY_MS * 2 ** (failures - 1))
}

export function isDue(state: FetchState | undefined, now: number, olderThan = REFRESH_EVERY_MS): boolean {
  if (!state || state.lastAttempt === null) return true
  if (state.failures > 0) return now - state.lastAttempt >= backoffMs(state.failures)
  return state.lastOk === null || now - state.lastOk >= olderThan
}

/** the text, or why there isn't one, in words for the calendar's row */
async function download(url: URL, deps: StoreDeps): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let fetched: Awaited<ReturnType<typeof guardedFetch>>
  try {
    fetched = await guardedFetch(
      url.href,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'text/calendar, text/plain;q=0.5' } },
      { fetch: deps.fetch, isAllowed: async hop => hop.protocol === 'https:' && (await deps.isPublicHost(hop.hostname)) },
      'calendar'
    )
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'it took more than 30 seconds' : err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Couldn't reach ${url.hostname}: ${reason}.` }
  }
  if (!fetched) return { ok: false, error: `${url.hostname} isn't an address Checkpoint will fetch from: it has to be https and public.` }
  const { response } = fetched
  if (!response.ok) {
    response.body?.cancel().catch(() => {})
    return { ok: false, error: `${url.hostname} answered ${response.status}${response.status === 404 || response.status === 403 ? '; the link may have been reset' : ''}.` }
  }
  const bytes = await readCapped(response, MAX_BYTES + 1)
  if (bytes.byteLength > MAX_BYTES) return { ok: false, error: 'That calendar is larger than 5 MB.' }
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '')
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) return { ok: false, error: "That link didn't return a calendar." }
  return { ok: true, text }
}

function parsedFor(id: string, text: string): ParsedCalendar {
  const hit = parsed.get(id)
  if (hit && hit.text === text) return hit.calendar
  const calendar = parseCalendar(text)
  parsed.set(id, { text, calendar })
  return calendar
}

function cachedText(id: string): string | null {
  const hit = parsed.get(id)
  if (hit) return hit.text
  try {
    return existsSync(cacheFile(id)) ? readFileSync(cacheFile(id), 'utf8') : null
  } catch {
    return null
  }
}

function view(s: Stored, state: FetchState | undefined): CalendarSubscription {
  return {
    id: s.id,
    name: s.name,
    color: s.color,
    workspace: s.workspace,
    host: normalizeLink(s.url)?.hostname ?? '',
    lastOk: state?.lastOk ?? null,
    error: state?.error ?? null
  }
}

/** never the link itself: it is a password for the calendar */
export function listSubscriptions(): CalendarSubscription[] {
  const state = readState()
  return readStored().map(s => view(s, state[s.id]))
}

/** fetched before it is kept, so a wrong link is caught while you are still looking at it */
export async function addSubscription(input: SubscriptionInput, deps: StoreDeps = real): Promise<{ ok: true; value: { subscription: CalendarSubscription; events: number } } | { ok: false; reason: string }> {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : ''
  if (!name) return { ok: false, reason: 'Give the calendar a name.' }
  const url = typeof input.url === 'string' ? normalizeLink(input.url) : null
  if (!url) return { ok: false, reason: 'Paste the calendar\'s private iCal link; it starts with https:// or webcal://.' }
  const stored = readStored()
  if (stored.length >= MAX_SUBSCRIPTIONS) return { ok: false, reason: `Checkpoint keeps at most ${MAX_SUBSCRIPTIONS} calendars.` }
  if (stored.some(s => normalizeLink(s.url)?.href === url.href)) return { ok: false, reason: 'That calendar is already added.' }

  const got = await download(url, deps)
  if (!got.ok) return { ok: false, reason: got.error }
  let calendar: ParsedCalendar
  try {
    calendar = parseCalendar(got.text)
  } catch (err) {
    return { ok: false, reason: `That calendar couldn't be read: ${err instanceof Error ? err.message : String(err)}` }
  }

  const now = deps.now()
  const subscription: Stored = {
    id: uuidv4(),
    name,
    url: url.href,
    color: typeof input.color === 'string' && HEX.test(input.color) ? input.color : '#535e85',
    workspace: typeof input.workspace === 'string' && input.workspace ? input.workspace : null,
    addedAt: now,
    updatedAt: now
  }
  ensureDir(getCalendarCacheDir())
  writeFileSync(cacheFile(subscription.id), got.text, 'utf8')
  parsed.set(subscription.id, { text: got.text, calendar })
  writeStored([...stored, subscription])
  const state: FetchState = { lastOk: now, lastAttempt: now, error: null, failures: 0 }
  writeState(subscription.id, state)
  return { ok: true, value: { subscription: view(subscription, state), events: calendar.count } }
}

export function updateSubscription(id: string, patch: Partial<Pick<SubscriptionInput, 'name' | 'color' | 'workspace'>>): { ok: true } | { ok: false; reason: string } {
  const stored = readStored()
  const s = stored.find(x => x.id === id)
  if (!s) return { ok: false, reason: 'That calendar is gone.' }
  if (typeof patch.name === 'string' && patch.name.trim()) s.name = patch.name.trim().slice(0, 60)
  if (typeof patch.color === 'string' && HEX.test(patch.color)) s.color = patch.color
  if (patch.workspace !== undefined) s.workspace = typeof patch.workspace === 'string' && patch.workspace ? patch.workspace : null
  s.updatedAt = Date.now()
  writeStored(stored)
  return { ok: true }
}

function dropCached(id: string): void {
  writeState(id, null)
  parsed.delete(id)
  try {
    rmSync(cacheFile(id), { force: true })
  } catch {
    // a cache file left behind is never read without its subscription
  }
}

/** gone here, and from your other computers when they next sync */
export function removeSubscription(id: string): void {
  const stored = readStored()
  if (!stored.some(s => s.id === id)) return
  writeStored(stored.filter(s => s.id !== id))
  dropCached(id)
  recordTombstone(id, SUBSCRIPTIONS_TABLE)
}

/** a removal synced from another computer; only ever one this computer has, so the id never reaches the disk unchecked */
export function forgetSubscription(id: string): void {
  const stored = readStored()
  if (!stored.some(s => s.id === id)) return
  writeStored(stored.filter(s => s.id !== id))
  dropCached(id)
}

/** links and all, for local-network sync only */
export const subscriptionsForSync = (): SyncedCalendarSubscription[] => readStored()

/** what another computer sent, checked as strictly as a link pasted here */
function syncedFrom(raw: unknown): Stored | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const name = typeof s.name === 'string' ? s.name.trim().slice(0, 60) : ''
  const url = typeof s.url === 'string' ? normalizeLink(s.url) : null
  if (typeof s.id !== 'string' || !ID.test(s.id) || !name || !url) return null
  if (typeof s.updatedAt !== 'number' || !Number.isFinite(s.updatedAt)) return null
  return {
    id: s.id,
    name,
    url: url.href,
    color: typeof s.color === 'string' && HEX.test(s.color) ? s.color : '#535e85',
    workspace: typeof s.workspace === 'string' && s.workspace ? s.workspace : null,
    addedAt: typeof s.addedAt === 'number' && Number.isFinite(s.addedAt) ? s.addedAt : s.updatedAt,
    updatedAt: s.updatedAt
  }
}

/** newest wins per calendar; one removed here stays removed; how many changed */
export function mergeSyncedSubscriptions(incoming: unknown, removed: ReadonlySet<string>): number {
  if (!Array.isArray(incoming)) return 0
  const stored = readStored()
  let changed = 0
  for (const raw of incoming) {
    const s = syncedFrom(raw)
    if (!s || removed.has(s.id)) continue
    const index = stored.findIndex(x => x.id === s.id)
    if (index === -1) {
      // the same link added on both computers before they synced stays as each one's own
      if (stored.length >= MAX_SUBSCRIPTIONS || stored.some(x => normalizeLink(x.url)?.href === s.url)) continue
      stored.push(s)
      changed++
    } else if (s.updatedAt > stored[index].updatedAt) {
      // a new link is a different calendar, so what was downloaded for the old one goes
      if (stored[index].url !== s.url) dropCached(s.id)
      stored[index] = s
      changed++
    }
  }
  if (changed > 0) writeStored(stored)
  return changed
}

/** refreshes what is due, or everything when forced; true when any calendar changed */
export async function refreshSubscriptions(force = false, olderThan = REFRESH_EVERY_MS, deps: StoreDeps = real): Promise<boolean> {
  const now = deps.now()
  const state = readState()
  let changed = false
  for (const s of readStored()) {
    if (!force && !isDue(state[s.id], now, olderThan)) continue
    const url = normalizeLink(s.url)
    const before = state[s.id] ?? { lastOk: null, lastAttempt: null, error: null, failures: 0 }
    const got = url ? await download(url, deps) : { ok: false as const, error: 'The saved link is not usable any more; remove the calendar and add it again.' }
    if (!got.ok) {
      writeState(s.id, { ...before, lastAttempt: now, error: got.error, failures: before.failures + 1 })
      changed = changed || before.error !== got.error
      continue
    }
    // read before parsing, which replaces the copy held in memory
    const previous = cachedText(s.id)
    try {
      parsedFor(s.id, got.text)
    } catch (err) {
      writeState(s.id, { ...before, lastAttempt: now, error: `It couldn't be read: ${err instanceof Error ? err.message : String(err)}`, failures: before.failures + 1 })
      continue
    }
    if (previous !== got.text) {
      ensureDir(getCalendarCacheDir())
      writeFileSync(cacheFile(s.id), got.text, 'utf8')
      changed = true
    }
    if (before.error) changed = true
    writeState(s.id, { lastOk: now, lastAttempt: now, error: null, failures: 0 })
  }
  return changed
}

/** events in range from what was last downloaded; a calendar that can't update still shows what it had */
export function subscribedEntries(from: number, to: number, workspaces: string[] | null): { entries: CalendarEntry[]; problems: string[] } {
  const scope = workspaces === null ? null : new Set(workspaces)
  const state = readState()
  const entries: CalendarEntry[] = []
  const problems: string[] = []
  for (const s of readStored()) {
    if (scope && s.workspace !== null && !scope.has(s.workspace)) continue
    const st = state[s.id]
    if (st?.error) {
      const when = st.lastOk ? ` Showing what it had on ${new Date(st.lastOk).toLocaleString()}.` : ''
      problems.push(`${s.name}: ${st.error}${when}`)
    }
    const text = cachedText(s.id)
    if (!text) continue
    try {
      entries.push(...eventsBetween(parsedFor(s.id, text), { id: s.id, color: s.color, workspace: s.workspace }, from, to))
    } catch (err) {
      problems.push(`${s.name} couldn't be read: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { entries, problems }
}

/** for tests */
export function clearParsedCalendars(): void {
  parsed.clear()
}
