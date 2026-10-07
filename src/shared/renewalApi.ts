/** what crosses IPC for renewals; main normalises every one before the renderer sees it */

import type { RenewalMeta } from './renewal'

/** a row as stored and synced; metadata is RenewalMeta as JSON */
export interface RenewalRow {
  id: string
  context: string
  title: string
  body: string
  status: string
  created_at: number
  updated_at: number
  metadata: string
}

/** per machine and never synced: what the last lookup saw */
export interface RenewalLookupState {
  /** last attempt, successful or not */
  checkedAt: number | null
  /** last success */
  okAt: number | null
  seenExpiry: number | null
  state: 'ok' | 'unsupported' | 'error'
  /** who issued a certificate and what it covers, or why the lookup failed */
  detail: string
  /** certificates only: whether it checked out; an unverified one can only bring the date earlier */
  verified: boolean | null
  nextAt: number
  failures: number
  /** an earlier date than the one stored, shown with Use it and never applied by itself */
  disagree: number | null
}

export interface RenewalRecord {
  id: string
  context: string
  title: string
  body: string
  status: 'active' | 'cancelled'
  createdAt: number
  updatedAt: number
  meta: RenewalMeta
  /** fields that couldn't be read and were left out */
  dropped: number
  snoozedUntil: number | null
  lookupState: RenewalLookupState | null
}

/** everything needed to put a renewal back exactly, for Undo */
export interface RenewalSnapshot {
  id: string
  context: string
  title: string
  body: string
  status: string
  metadata: string
  createdAt: number
}

export interface RenewalCreateInput {
  context: string
  title: string
  body?: string
  meta: unknown
}

export interface RenewalPatch {
  title?: string
  body?: string
  status?: 'active' | 'cancelled'
  context?: string
  meta?: unknown
}

export type RenewalResult<T> = { ok: true; value: T } | { ok: false; reason: string }
