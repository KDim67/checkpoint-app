/** a renewal checking its own date: the domain's registry over RDAP, or the certificate the site serves */

import net from 'node:net'
import tls from 'node:tls'
import { getSetting, setSetting } from './db'
import { guardedFetch, readCapped } from './guardedFetch'
import { isPublicHost } from './publicAddress'
import { getRenewal, listRenewals, LOOKUP_STATE_SETTING, readMap, updateRenewal } from './renewals'
import { allDay, DAY_MS, localDayOf, moment } from '../shared/dueDate'
import {
  candidateNames,
  expirationFrom,
  parseBootstrap,
  RDAP_BOOTSTRAP_URL,
  rdapBaseFor,
  rdapDomainUrl,
  retryAfterMs
} from '../shared/rdap'
import { isExpired, isInWarningWindow, type RenewalLookupConfig } from '../shared/renewal'
import type { RenewalLookupState, RenewalRecord, RenewalResult } from '../shared/renewalApi'
import { normalizeHost } from '../shared/renewalText'
import { applyLookup, pendingRenewal } from '../shared/renewalTrust'

const TIMEOUT_MS = 10_000
const USER_AGENT = 'Checkpoint (renewal reminders)'
const BOOTSTRAP_SETTING = 'rdap_bootstrap'
const BOOTSTRAP_MAX_AGE_MS = 7 * DAY_MS
const RESPONSE_BYTES = 512 * 1024
export const MAX_PER_SWEEP = 5
const PARALLEL = 2
/** a registry that publishes no date won't start to, so it isn't asked again unless you ask */
const UNSUPPORTED_RETRY_MS = 365 * DAY_MS

export interface CertReading {
  validTo: number
  issuer: string
  names: string[]
  /** the chain checked out and the name matched */
  trusted: boolean
  problem: string | null
}

export interface LookupDeps {
  fetch: typeof fetch
  isAllowed: (url: URL) => Promise<boolean>
  readCertificate: (host: string, port: number) => Promise<CertReading>
}

export type LookupOutcome =
  | { kind: 'found'; expiresAt: number; detail: string; verified: boolean | null }
  | { kind: 'unsupported'; detail: string }
  | { kind: 'error'; detail: string; retryAfterMs: number | null }

const PROBLEM_WORDS: Record<string, string> = {
  CERT_HAS_EXPIRED: 'Certificate expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Not trusted: self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'Not trusted: self-signed',
  name: 'Issued for a different name'
}

/**
 * not refused at connect time, since an expired or self-signed certificate is exactly what this must read;
 * whether it checked out is recorded instead, and the trust rules never let an untrusted one move a date later
 */
function readCertificateTls(host: string, port: number): Promise<CertReading> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      timeout: TIMEOUT_MS
    })
    const finish = (settle: () => void): void => {
      socket.removeAllListeners()
      socket.destroy()
      settle()
    }
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      if (!cert || !cert.valid_to) {
        finish(() => reject(new Error('The site sent no certificate.')))
        return
      }
      const mismatch = tls.checkServerIdentity(host, cert)
      const chainError = socket.authorized ? null : String(socket.authorizationError ?? 'untrusted')
      // a field can repeat, and then comes back as a list
      const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '')
      const issuer = first(cert.issuer?.O) || first(cert.issuer?.CN) || 'Unknown issuer'
      const names = (cert.subjectaltname ?? '')
        .split(',')
        .map(s => s.trim().replace(/^(DNS|IP Address):/, ''))
        .filter(Boolean)
      finish(() =>
        resolve({
          validTo: Date.parse(cert.valid_to),
          issuer,
          names,
          trusted: !chainError && !mismatch,
          problem: chainError ?? (mismatch ? 'name' : null)
        })
      )
    })
    socket.once('timeout', () => finish(() => reject(new Error('The site did not answer in time.'))))
    socket.once('error', err => finish(() => reject(err)))
  })
}

const defaultDeps: LookupDeps = {
  fetch: (input, init) => fetch(input, init),
  isAllowed: url => isPublicHost(url.hostname),
  readCertificate: readCertificateTls
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

async function getJson(url: string, deps: LookupDeps, accept: string) {
  const fetched = await guardedFetch(
    url,
    { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: accept, 'User-Agent': USER_AGENT } },
    deps,
    'renewals'
  )
  if (!fetched) return { status: 0, json: null, retryAfter: null as string | null }
  const { response } = fetched
  const retryAfter = response.headers.get('retry-after')
  if (!response.ok) {
    response.body?.cancel().catch(() => {})
    return { status: response.status, json: null, retryAfter }
  }
  const bytes = await readCapped(response, RESPONSE_BYTES)
  try {
    return { status: response.status, json: JSON.parse(new TextDecoder().decode(bytes)) as unknown, retryAfter }
  } catch {
    return { status: response.status, json: null, retryAfter }
  }
}

/** IANA's list of registries, kept a week; a stale copy beats none when IANA can't be reached */
async function registries(deps: LookupDeps, now: number): Promise<Record<string, string[]> | null> {
  const cached = getSetting<{ fetchedAt?: number; services?: unknown } | null>(BOOTSTRAP_SETTING, null)
  const cachedServices = cached?.services ? parseBootstrap({ services: cached.services }) : null
  if (cachedServices && typeof cached?.fetchedAt === 'number' && now - cached.fetchedAt < BOOTSTRAP_MAX_AGE_MS) {
    return cachedServices
  }
  try {
    const { json } = await getJson(RDAP_BOOTSTRAP_URL, deps, 'application/json')
    const services = parseBootstrap(json)
    if (services && json && typeof json === 'object') {
      setSetting(BOOTSTRAP_SETTING, { fetchedAt: now, services: (json as { services: unknown }).services })
      return services
    }
  } catch (err) {
    console.warn('[renewals] Could not fetch the RDAP registry list:', err)
  }
  return cachedServices
}

export async function lookupDomain(target: string, deps: LookupDeps = defaultDeps, now = Date.now()): Promise<LookupOutcome> {
  const host = normalizeHost(target)
  if (!host) return { kind: 'unsupported', detail: 'That is not a domain name.' }
  const ending = host.slice(host.lastIndexOf('.') + 1)

  const services = await registries(deps, now)
  if (!services) return { kind: 'error', detail: 'Could not reach the list of registries.', retryAfterMs: null }
  const base = rdapBaseFor(services, host)
  const unpublished = `The .${ending} registry doesn't publish expiry dates. Enter it yourself and you'll still be warned.`
  if (!base) return { kind: 'unsupported', detail: unpublished }

  for (const name of candidateNames(host)) {
    let answer: Awaited<ReturnType<typeof getJson>>
    try {
      answer = await getJson(rdapDomainUrl(base, name), deps, 'application/rdap+json, application/json')
    } catch (err) {
      return { kind: 'error', detail: `Could not reach the registry: ${message(err)}`, retryAfterMs: null }
    }
    if (answer.status === 404) continue
    if (answer.status === 429) {
      return { kind: 'error', detail: 'The registry asked to wait before asking again.', retryAfterMs: retryAfterMs(answer.retryAfter, now) }
    }
    if (answer.status === 0) return { kind: 'error', detail: 'The registry could not be reached.', retryAfterMs: null }
    if (answer.status >= 400) return { kind: 'error', detail: `The registry answered ${answer.status}.`, retryAfterMs: null }
    const at = expirationFrom(answer.json)
    if (at === null) return { kind: 'unsupported', detail: unpublished }
    // a domain lapses on a day; which second of it is the registry's business
    return { kind: 'found', expiresAt: allDay(localDayOf(at)), detail: `${name} at the registry`, verified: null }
  }
  return { kind: 'error', detail: `The registry has no record of ${host}.`, retryAfterMs: null }
}

/** the host and port someone typed, a bare name, a link, or an address; www is kept, it may have its own */
export function certificateTarget(target: string, port: number | null): { host: string; port: number } | null {
  const text = (target ?? '').trim()
  if (!text) return null
  if (net.isIP(text)) return { host: text, port: port ?? 443 }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!host) return null
    return { host, port: port ?? (url.port ? Number(url.port) : 443) }
  } catch {
    return null
  }
}

export async function lookupCertificate(
  target: string,
  port: number | null,
  deps: LookupDeps = defaultDeps
): Promise<LookupOutcome> {
  const where = certificateTarget(target, port)
  if (!where) return { kind: 'unsupported', detail: 'That is not a host name or address.' }
  try {
    const cert = await deps.readCertificate(where.host, where.port)
    if (!Number.isFinite(cert.validTo)) return { kind: 'error', detail: 'The certificate has no end date.', retryAfterMs: null }
    const covers = cert.names.length ? `, covers ${cert.names.slice(0, 4).join(', ')}${cert.names.length > 4 ? ' and more' : ''}` : ''
    const problem = cert.problem ? `. ${PROBLEM_WORDS[cert.problem] ?? 'Not trusted'}` : ''
    return {
      kind: 'found',
      expiresAt: moment(new Date(cert.validTo)),
      detail: `${cert.issuer}${covers}${problem}`,
      verified: cert.trusted
    }
  } catch (err) {
    return { kind: 'error', detail: `Could not read the certificate: ${message(err)}`, retryAfterMs: null }
  }
}

export function lookupFor(config: RenewalLookupConfig, deps: LookupDeps = defaultDeps, now = Date.now()): Promise<LookupOutcome> {
  return config.source === 'rdap' ? lookupDomain(config.target, deps, now) : lookupCertificate(config.target, config.port, deps)
}

/** daily while it matters, weekly otherwise, longer after each failure up to a day */
export function nextCheck(record: RenewalRecord, outcome: LookupOutcome, failures: number, now: number): number {
  if (outcome.kind === 'unsupported') return now + UNSUPPORTED_RETRY_MS
  if (outcome.kind === 'error') {
    const backoff = Math.min(DAY_MS, 2 ** Math.min(failures, 5) * 60 * 60 * 1000)
    return now + Math.max(backoff, outcome.retryAfterMs ?? 0)
  }
  const { meta } = record
  const urgent =
    pendingRenewal(meta) !== null ||
    (meta.expiresAt !== null && (isExpired(meta.expiresAt, now) || isInWarningWindow(meta, now)))
  return now + (urgent ? DAY_MS : 7 * DAY_MS)
}

function saveState(id: string, state: RenewalLookupState): void {
  const states = readMap<RenewalLookupState>(LOOKUP_STATE_SETTING)
  states[id] = state
  setSetting(LOOKUP_STATE_SETTING, states)
}

/** what the lookup saw, kept on this machine; written into the item only when the date itself changes */
function record(entry: RenewalRecord, outcome: LookupOutcome, now: number, disagree: number | null): void {
  const previous = entry.lookupState
  const failures = outcome.kind === 'error' ? (previous?.failures ?? 0) + 1 : 0
  saveState(entry.id, {
    checkedAt: now,
    okAt: outcome.kind === 'found' ? now : previous?.okAt ?? null,
    seenExpiry: outcome.kind === 'found' ? outcome.expiresAt : previous?.seenExpiry ?? null,
    state: outcome.kind === 'found' ? 'ok' : outcome.kind,
    detail: outcome.detail,
    verified: outcome.kind === 'found' ? outcome.verified : previous?.verified ?? null,
    nextAt: nextCheck(entry, outcome, failures, now),
    failures,
    disagree
  })
}

async function checkOne(entry: RenewalRecord, deps: LookupDeps, now: number): Promise<RenewalRecord> {
  const config = entry.meta.lookup
  if (!config) return entry
  const outcome = await lookupFor(config, deps, now)
  let disagree: number | null = null
  if (outcome.kind === 'found') {
    const decision = applyLookup(entry.meta, outcome.expiresAt, outcome.verified, now)
    disagree = decision.disagree
    if (decision.meta) {
      const saved = updateRenewal(entry.id, { meta: decision.meta })
      if (saved.ok) entry = saved.value
    }
  }
  record(entry, outcome, now, disagree)
  return getRenewal(entry.id, now) ?? entry
}

export async function lookupRenewal(id: string, deps: LookupDeps = defaultDeps, now = Date.now()): Promise<RenewalResult<RenewalRecord>> {
  const entry = getRenewal(id, now)
  if (!entry) return { ok: false, reason: 'That renewal no longer exists.' }
  if (!entry.meta.lookup) return { ok: false, reason: 'Add a domain or host to check first.' }
  return { ok: true, value: await checkOne(entry, deps, now) }
}

/** the background part: a few each sweep, two at a time, nearest-due first */
export async function runDueLookups(now = Date.now(), deps: LookupDeps = defaultDeps): Promise<number> {
  const due = listRenewals(undefined, now)
    .filter(r => r.status === 'active' && r.meta.lookup?.auto && (!r.lookupState || r.lookupState.nextAt <= now))
    .sort((a, b) => (a.lookupState?.nextAt ?? 0) - (b.lookupState?.nextAt ?? 0))
    .slice(0, MAX_PER_SWEEP)

  let changed = 0
  for (let i = 0; i < due.length; i += PARALLEL) {
    const results = await Promise.all(
      due.slice(i, i + PARALLEL).map(async entry => {
        try {
          const after = await checkOne(entry, deps, now)
          return after.meta.expiresAt !== entry.meta.expiresAt
        } catch (err) {
          console.error('[renewals] Lookup failed for', entry.id, err)
          return false
        }
      })
    )
    changed += results.filter(Boolean).length
  }
  return changed
}

