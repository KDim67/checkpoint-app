/** how a connection is doing on this computer; kept home, another computer may have no key at all */

import { deleteSetting, getSetting, setSetting } from '../db'
import type { ConnectionService } from '../../shared/connections'

export interface ServiceStatus {
  login: string | null
  /** when the key stops working, if the service says */
  expiresAt: number | null
  lastOk: number | null
  lastAttempt: number | null
  error: string | null
  failures: number
  /** a rate limit was hit; nothing is asked before this */
  rateResetAt: number | null
  /** the expiry already warned about, so it is said once */
  noticedExpiry: number | null
  /** a stopped key already said, until it works again */
  noticedFailure: boolean
  /** repositories or teams where a change was refused, so this key can only read them */
  readOnlyRepos: string[]
}

const EMPTY: ServiceStatus = {
  login: null,
  expiresAt: null,
  lastOk: null,
  lastAttempt: null,
  error: null,
  failures: 0,
  rateResetAt: null,
  noticedExpiry: null,
  noticedFailure: false,
  readOnlyRepos: []
}

const statusName = (service: ConnectionService): string => `connection_status:${service}`

const numberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** a damaged record reads as a fresh one, never as a wrong one */
export function readStatus(service: ConnectionService): ServiceStatus {
  const raw = getSetting<unknown>(statusName(service), null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY }
  const s = raw as Record<string, unknown>
  return {
    login: typeof s.login === 'string' ? s.login : null,
    expiresAt: numberOrNull(s.expiresAt),
    lastOk: numberOrNull(s.lastOk),
    lastAttempt: numberOrNull(s.lastAttempt),
    error: typeof s.error === 'string' ? s.error : null,
    failures: typeof s.failures === 'number' && s.failures > 0 ? Math.floor(s.failures) : 0,
    rateResetAt: numberOrNull(s.rateResetAt),
    noticedExpiry: numberOrNull(s.noticedExpiry),
    noticedFailure: s.noticedFailure === true,
    readOnlyRepos: Array.isArray(s.readOnlyRepos) ? s.readOnlyRepos.filter((x): x is string => typeof x === 'string') : []
  }
}

export function writeStatus(service: ConnectionService, patch: Partial<ServiceStatus>): ServiceStatus {
  const next = { ...readStatus(service), ...patch }
  setSetting(statusName(service), next)
  return next
}

export function clearStatus(service: ConnectionService): void {
  deleteSetting(statusName(service))
}
