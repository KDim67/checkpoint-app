import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '../src/main/db'
import { createRenewal, getRenewal, markRenewed } from '../src/main/renewals'
import {
  certificateTarget,
  lookupCertificate,
  lookupDomain,
  lookupRenewal,
  type CertReading,
  type LookupDeps
} from '../src/main/renewalLookup'
import { candidateNames, expirationFrom, parseBootstrap, rdapBaseFor, retryAfterMs } from '../src/shared/rdap'
import { applyLookup } from '../src/shared/renewalTrust'
import { normalizeRenewal, renewTo } from '../src/shared/renewal'
import { renewalNotices } from '../src/shared/renewalWarnings'
import { allDay, dueDay, isAllDay, localDayOf } from '../src/shared/dueDate'
import type { RenewalLookupState } from '../src/shared/renewalApi'

/** the value, or a failure that says it was missing */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value')
  return value
}

const day = (year: number, month: number, d: number): number => allDay({ year, month, day: d })
const DAY = 86_400_000

describe('reading RDAP', () => {
  it('maps endings to https registries only', () => {
    const services = must(parseBootstrap({ services: [[['dev', 'app'], ['https://rdap.example/']], [['de'], ['http://plain.example/']]] }))
    expect(rdapBaseFor(services, 'acme.dev')).toBe('https://rdap.example/')
    expect(rdapBaseFor(services, 'acme.de')).toBeNull()
    expect(parseBootstrap({ nope: true })).toBeNull()
  })

  it('walks from a subdomain to the registered name, never to a second level like co.uk', () => {
    expect(candidateNames('app.acme.co.uk')).toStrictEqual(['app.acme.co.uk', 'acme.co.uk'])
    expect(candidateNames('api.eu.acme.dev')).toStrictEqual(['api.eu.acme.dev', 'eu.acme.dev', 'acme.dev'])
  })

  it('finds the expiration event, whatever its case', () => {
    expect(expirationFrom({ events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }, { eventAction: 'Expiration', eventDate: '2027-10-20T14:03:11Z' }] }))
      .toBe(Date.parse('2027-10-20T14:03:11Z'))
    expect(expirationFrom({ events: [{ eventAction: 'last changed', eventDate: '2027-01-01' }] })).toBeNull()
  })

  it('reads Retry-After in seconds or as a date', () => {
    expect(retryAfterMs('120', 0)).toBe(120_000)
    expect(retryAfterMs(new Date(60_000).toUTCString(), 0)).toBe(60_000)
    expect(retryAfterMs('soon', 0)).toBeNull()
  })
})

describe('what a lookup may change', () => {
  const now = new Date(2026, 9, 10, 10).getTime()
  const meta = (extra: object) => normalizeRenewal({ lookup: { source: 'rdap', target: 'acme.dev' }, ...extra }).meta

  it('fills the first date in', () => {
    expect(applyLookup(meta({}), day(2027, 9, 20), null, now).meta?.expiresAt).toBe(day(2027, 9, 20))
  })

  it('takes a later date as a renewal it did by itself', () => {
    const decision = applyLookup(meta({ expiresAt: day(2026, 9, 20) }), day(2027, 9, 20), null, now)
    expect(decision.meta?.expiresAt).toBe(day(2027, 9, 20))
    expect(decision.meta?.history[0]).toMatchObject({ by: 'registry', confirmed: true })
  })

  it('only shows an earlier date, never applies it', () => {
    expect(applyLookup(meta({ expiresAt: day(2027, 9, 20) }), day(2026, 9, 20), null, now)).toStrictEqual({ meta: null, disagree: day(2026, 9, 20) })
  })

  it('confirms a renewal you clicked once the registry shows it', () => {
    const clicked = renewTo(meta({ expiresAt: day(2026, 9, 20) }), day(2027, 9, 20), 'you', now, false)
    const decision = applyLookup(clicked, day(2027, 9, 20), null, now + DAY)
    expect(decision.meta?.history[0]).toMatchObject({ by: 'you', confirmed: true })
  })

  it('says nothing, rather than disagreeing, while the registry still shows the old date', () => {
    const clicked = renewTo(meta({ expiresAt: day(2026, 9, 20) }), day(2027, 9, 20), 'you', now, false)
    expect(applyLookup(clicked, day(2026, 9, 20), null, now + DAY)).toStrictEqual({ meta: null, disagree: null })
  })

  it('never lets a certificate that did not check out push the date later', () => {
    const cert = normalizeRenewal({ expiresAt: day(2026, 10, 1), lookup: { source: 'tls', target: 'acme.dev' } }).meta
    expect(applyLookup(cert, day(2030, 0, 1), false, now)).toStrictEqual({ meta: null, disagree: null })
    // but an earlier one, which can only make it more urgent, is still shown
    expect(applyLookup(cert, day(2026, 9, 12), false, now).disagree).toBe(day(2026, 9, 12))
  })
})

/** a registry that answers from a table, and counts what it was asked */
function registry(routes: Record<string, () => Response>, blocked: string[] = []) {
  const asked: string[] = []
  const deps: LookupDeps = {
    fetch: (async (input: string | URL) => {
      const url = String(input)
      asked.push(url)
      const route = routes[url]
      return route ? route() : new Response('not found', { status: 404 })
    }) as typeof fetch,
    isAllowed: async url => !blocked.includes(url.hostname),
    readCertificate: async () => { throw new Error('no certificates here') }
  }
  return { deps, asked }
}

const json = (body: unknown, init: ResponseInit = {}) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/rdap+json' }, ...init })

const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json'
const bootstrap = json({ services: [[['dev'], ['https://rdap.example/']], [['de'], ['https://rdap.denic.example/']]] })
const expiring = (iso: string) => json({ events: [{ eventAction: 'expiration', eventDate: iso }] })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'checkpoint-lookup-'))
  initDb(dir)
})
afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('asking a registry', () => {
  it('finds the date for a subdomain from its registered name, as a whole day', async () => {
    const { deps } = registry({ [BOOTSTRAP]: bootstrap, 'https://rdap.example/domain/acme.dev': expiring('2027-10-20T14:03:11Z') })
    const outcome = await lookupDomain('https://app.acme.dev/login', deps)
    expect(outcome.kind).toBe('found')
    if (outcome.kind !== 'found') return
    expect(isAllDay(outcome.expiresAt)).toBe(true)
    expect(dueDay(outcome.expiresAt)).toStrictEqual(localDayOf(Date.parse('2027-10-20T14:03:11Z')))
  })

  it('keeps the registry list for a week instead of asking each time', async () => {
    const { deps, asked } = registry({ [BOOTSTRAP]: bootstrap, 'https://rdap.example/domain/acme.dev': expiring('2027-10-20T00:00:00Z') })
    await lookupDomain('acme.dev', deps)
    await lookupDomain('acme.dev', deps)
    expect(asked.filter(u => u === BOOTSTRAP)).toHaveLength(1)
  })

  it('says plainly when a registry publishes no date', async () => {
    const { deps } = registry({ [BOOTSTRAP]: bootstrap, 'https://rdap.denic.example/domain/acme.de': json({ events: [] }) })
    expect(await lookupDomain('acme.de', deps)).toMatchObject({ kind: 'unsupported', detail: expect.stringContaining('.de registry') })
  })

  it('backs off when told to wait', async () => {
    const { deps } = registry({
      [BOOTSTRAP]: bootstrap,
      'https://rdap.example/domain/acme.dev': () => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } })
    })
    expect(await lookupDomain('acme.dev', deps)).toMatchObject({ kind: 'error', retryAfterMs: 120_000 })
  })

  it('refuses a redirect to a private address', async () => {
    const { deps, asked } = registry({
      [BOOTSTRAP]: bootstrap,
      'https://rdap.example/domain/acme.dev': () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/admin' } })
    }, ['10.0.0.5'])
    expect(await lookupDomain('acme.dev', deps)).toMatchObject({ kind: 'error' })
    expect(asked.some(u => u.includes('10.0.0.5'))).toBe(false)
  })
})

describe('reading a certificate', () => {
  const reading = (over: Partial<CertReading>): LookupDeps => ({
    ...registry({}).deps,
    readCertificate: async () => ({ validTo: Date.parse('2026-10-01T12:00:00Z'), issuer: 'Acme CA', names: ['acme.dev', 'www.acme.dev'], trusted: true, problem: null, ...over })
  })

  it('reads one that has expired, and says it did not check out', async () => {
    const outcome = await lookupCertificate('acme.dev', null, reading({ trusted: false, problem: 'CERT_HAS_EXPIRED' }))
    expect(outcome).toMatchObject({ kind: 'found', verified: false, detail: 'Acme CA, covers acme.dev, www.acme.dev. Certificate expired' })
    if (outcome.kind === 'found') expect(isAllDay(outcome.expiresAt)).toBe(false)
  })

  it('keeps www and the port from what was typed', () => {
    expect(certificateTarget('https://www.acme.dev:8443/x', null)).toStrictEqual({ host: 'www.acme.dev', port: 8443 })
    expect(certificateTarget('10.0.0.5', null)).toStrictEqual({ host: '10.0.0.5', port: 443 })
    expect(certificateTarget('intranet.local', 9443)).toStrictEqual({ host: 'intranet.local', port: 9443 })
  })
})

describe('lookups on stored renewals', () => {
  const create = (meta: object) => {
    const r = createRenewal({ context: 'work', title: 'acme.dev', meta: { lookup: { source: 'rdap', target: 'acme.dev', auto: true }, ...meta } })
    if (!r.ok) throw new Error(r.reason)
    return r.value
  }
  const answering = (iso: string) =>
    registry({ [BOOTSTRAP]: bootstrap, 'https://rdap.example/domain/acme.dev': expiring(iso) }).deps

  it('adopts a later date and records where it came from', async () => {
    const r = create({ expiresAt: day(2026, 9, 20) })
    const result = await lookupRenewal(r.id, answering('2027-10-20T12:00:00Z'))
    expect(result.ok && result.value.meta.history[0]).toMatchObject({ by: 'registry', confirmed: true })
    expect(must(getRenewal(r.id)).lookupState).toMatchObject({ state: 'ok', disagree: null, failures: 0 })
  })

  it('keeps an earlier date to one side for you to decide on', async () => {
    const r = create({ expiresAt: day(2028, 9, 20) })
    await lookupRenewal(r.id, answering('2027-10-20T12:00:00Z'))
    const after = must(getRenewal(r.id))
    expect(after.meta.expiresAt).toBe(day(2028, 9, 20))
    expect(after.lookupState?.disagree).not.toBeNull()
  })

  it('counts failures and waits longer after each', async () => {
    const r = create({ expiresAt: day(2027, 9, 20) })
    const broken = registry({ [BOOTSTRAP]: bootstrap, 'https://rdap.example/domain/acme.dev': () => new Response('', { status: 500 }) }).deps
    const now = Date.now()
    await lookupRenewal(r.id, broken, now)
    const first = must(must(getRenewal(r.id)).lookupState)
    await lookupRenewal(r.id, broken, now)
    const second = must(must(getRenewal(r.id)).lookupState)
    expect([first.failures, second.failures]).toStrictEqual([1, 2])
    expect(second.nextAt - now).toBeGreaterThan(first.nextAt - now)
  })

  it('renews at once, then takes the registry\'s own date once it shows the renewal', async () => {
    const now = new Date(2026, 9, 10).getTime()
    const r = create({ expiresAt: day(2026, 9, 20), cycle: { every: 1, unit: 'year' } })
    const renewed = markRenewed(r.id, null, now)
    expect(renewed.ok && renewed.value.record.meta.history[0]).toMatchObject({ by: 'you', confirmed: false, to: day(2027, 9, 20) })
    // renewed for two years at the registrar, so the registry knows better than the cycle
    await lookupRenewal(r.id, answering('2028-10-20T12:00:00Z'), now)
    const after = must(getRenewal(r.id))
    expect(after.meta.history[0]).toMatchObject({ by: 'you', confirmed: true })
    expect(dueDay(must(after.meta.expiresAt)).year).toBe(2028)
  })

  it('stays waiting while the registry still shows the old date', async () => {
    const now = new Date(2026, 9, 10).getTime()
    const r = create({ expiresAt: day(2026, 9, 20), cycle: { every: 1, unit: 'year' } })
    markRenewed(r.id, null, now)
    await lookupRenewal(r.id, answering('2026-10-20T12:00:00Z'), now)
    const after = must(getRenewal(r.id))
    expect(after.meta.history[0]).toMatchObject({ confirmed: false, to: day(2027, 9, 20) })
    expect(after.lookupState?.disagree).toBeNull()
  })
})

describe('warning that a renewal did not go through', () => {
  const renewedAt = new Date(2026, 9, 1, 10).getTime()
  const clicked = {
    id: 'r1',
    title: 'acme.dev',
    status: 'active',
    meta: renewTo(
      normalizeRenewal({ expiresAt: day(2026, 9, 5), cycle: { every: 1, unit: 'year' }, warnAt: [], lookup: { source: 'rdap', target: 'acme.dev' } }).meta,
      day(2027, 9, 5), 'you', renewedAt, false
    )
  }
  const state = (over: Partial<RenewalLookupState>): RenewalLookupState => ({
    checkedAt: null, okAt: null, seenExpiry: null, state: 'ok', detail: '', verified: null, nextAt: 0, failures: 0, disagree: null, ...over
  })

  it('warns once the registry has had three days and still shows the old date', () => {
    const now = new Date(2026, 9, 4, 10).getTime()
    const seen = state({ okAt: now - 1000, seenExpiry: day(2026, 9, 5) })
    expect(renewalNotices(clicked, now, new Set(), null, seen).notices.map(n => n.body))
      .toStrictEqual(['Still shows the old expiry at the registry. The renewal may not have gone through.'])
    expect(renewalNotices(clicked, new Date(2026, 9, 3, 10).getTime(), new Set(), null, seen).notices).toStrictEqual([])
  })

  it('never warns on the strength of a lookup that failed', () => {
    const now = new Date(2026, 9, 6, 10).getTime()
    const failed = state({ state: 'error', okAt: renewedAt - DAY, seenExpiry: day(2026, 9, 5) })
    expect(renewalNotices(clicked, now, new Set(), null, failed).notices).toStrictEqual([])
  })

  it('warns when one set to renew itself has not, by the registry\'s own record', () => {
    const auto = {
      ...clicked,
      meta: normalizeRenewal({ expiresAt: day(2026, 9, 5), renews: 'auto', cycle: { every: 1, unit: 'year' }, lookup: { source: 'rdap', target: 'acme.dev' } }).meta
    }
    const now = new Date(2026, 9, 7, 10).getTime()
    const seen = state({ okAt: now - 1000, seenExpiry: day(2026, 9, 5) })
    expect(renewalNotices(auto, now, new Set(), null, seen).notices[0].body).toMatch(/^Set to renew itself, but the registry still shows it expiring on /)
  })
})
