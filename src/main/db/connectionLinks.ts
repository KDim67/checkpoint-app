/** what both sides last agreed on, per outside item, on this computer; never synced, each computer settles on its own */

import type Database from 'better-sqlite3'
import type { ConnectionService } from '../../shared/connections'

/** ignored: you deleted its card, so it never comes back */
export type Agreed = 'open' | 'closed' | 'ignored'

export interface AgreedRow {
  remoteId: string
  itemId: string
  agreed: Agreed
}

/** the last version of each two-way field both sides held; a field never agreed is absent */
export interface AgreedFields {
  title?: string
  body?: string
  due?: number | null
}

const AGREED: readonly Agreed[] = ['open', 'closed', 'ignored']

const toRow = (row: { remote_id: string; item_id: string; agreed: string }): AgreedRow | null =>
  AGREED.includes(row.agreed as Agreed) ? { remoteId: row.remote_id, itemId: row.item_id, agreed: row.agreed as Agreed } : null

/** a table made before fields were kept gains the column; its rows read as nothing agreed */
export function ensureAgreedFieldsColumn(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(connection_links)').all() as { name: string }[]
  if (columns.length > 0 && !columns.some(c => c.name === 'fields')) {
    db.exec(`ALTER TABLE connection_links ADD COLUMN fields TEXT NOT NULL DEFAULT '{}'`)
  }
}

export function getAgreed(db: Database.Database, service: ConnectionService, remoteId: string): AgreedRow | null {
  const row = db.prepare('SELECT remote_id, item_id, agreed FROM connection_links WHERE service = ? AND remote_id = ?')
    .get(service, remoteId) as { remote_id: string; item_id: string; agreed: string } | undefined
  return row ? toRow(row) : null
}

export function setAgreed(db: Database.Database, service: ConnectionService, remoteId: string, itemId: string, agreed: Agreed): void {
  db.prepare(`INSERT INTO connection_links (service, remote_id, item_id, agreed) VALUES (?, ?, ?, ?)
    ON CONFLICT(service, remote_id) DO UPDATE SET item_id = excluded.item_id, agreed = excluded.agreed`)
    .run(service, remoteId, itemId, agreed)
}

export function listAgreed(db: Database.Database, service: ConnectionService): AgreedRow[] {
  const rows = db.prepare('SELECT remote_id, item_id, agreed FROM connection_links WHERE service = ?')
    .all(service) as { remote_id: string; item_id: string; agreed: string }[]
  return rows.map(toRow).filter((r): r is AgreedRow => r !== null)
}

/** a damaged record, or a field of the wrong kind, reads as never agreed, so the service's version is taken */
export function getAgreedFields(db: Database.Database, service: ConnectionService, remoteId: string): AgreedFields {
  const row = db.prepare('SELECT fields FROM connection_links WHERE service = ? AND remote_id = ?')
    .get(service, remoteId) as { fields: string } | undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(row?.fields || '{}')
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const f = parsed as Record<string, unknown>
  const out: AgreedFields = {}
  if (typeof f.title === 'string') out.title = f.title
  if (typeof f.body === 'string') out.body = f.body
  if (f.due === null || (typeof f.due === 'number' && Number.isFinite(f.due))) out.due = f.due
  return out
}

/** merged into what is kept; the row must already exist, made by setAgreed */
export function setAgreedFields(db: Database.Database, service: ConnectionService, remoteId: string, fields: AgreedFields): void {
  const next = { ...getAgreedFields(db, service, remoteId), ...fields }
  db.prepare('UPDATE connection_links SET fields = ? WHERE service = ? AND remote_id = ?').run(JSON.stringify(next), service, remoteId)
}
