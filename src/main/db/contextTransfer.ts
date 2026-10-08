import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { Item, Tag, Relation, ContextExport, ContextRename } from '../../shared/types'
import type { RenewalRow } from '../../shared/renewalApi'
import { normalizeRenewal } from '../../shared/renewal'
import { contextSettingKeys, directContextSettingKeys, remapContextSettings } from '../../shared/contextSettings'
import { wallIndexKey } from '../../shared/wallModel'
import { isSecretSetting } from '../secureSettings'

export function exportContextData(db: Database.Database, context: string): ContextExport {
  const items = db.prepare(`SELECT * FROM items WHERE context = ?`).all(context) as Item[]
  const itemIds = items.map(i => i.id)

  let tags: Tag[] = []
  let item_tags: ContextExport['item_tags'] = []
  let relations: Relation[] = []

  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',')
    
    tags = db.prepare(`
      SELECT DISTINCT t.* FROM tags t
      INNER JOIN item_tags it ON t.id = it.tag_id
      WHERE it.item_id IN (${placeholders})
    `).all(...itemIds) as Tag[]

    item_tags = db.prepare(`
      SELECT * FROM item_tags
      WHERE item_id IN (${placeholders})
    `).all(...itemIds) as ContextExport['item_tags']

    relations = db.prepare(`
      SELECT * FROM relations
      WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})
    `).all(...itemIds, ...itemIds) as Relation[]
  }

  // columns, background, walls etc live in app_settings; without them the board comes back unconfigured
  const settings: Record<string, string> = {}
  const readSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
  const collect = (key: string): void => {
    // secrets are machine-bound; none here, the guard keeps it that way
    if (isSecretSetting(key)) return
    const row = readSetting.get(key) as { value: string } | undefined
    if (row) settings[key] = row.value
  }

  // read the index first, walls after the first are keyed by their own id
  const storedIndex = (readSetting.get(wallIndexKey(context)) as { value: string } | undefined)?.value
  contextSettingKeys(context, storedIndex ?? null).forEach(collect)

  const renewals = db.prepare(`SELECT * FROM renewals WHERE context = ?`).all(context) as RenewalRow[]

  return {
    version: 2,
    context,
    items,
    tags,
    item_tags,
    relations,
    settings,
    renewals
  }
}

export function importContextData(db: Database.Database, newContextSlug: string, data: ContextExport): void {
  db.transaction(() => {
    const stmtTag = db.prepare(`INSERT OR IGNORE INTO tags (id, name, color) VALUES (@id, @name, @color)`)
    if (Array.isArray(data.tags)) {
      for (const t of data.tags) {
        stmtTag.run(t)
      }
    }

    const stmtItem = db.prepare(`
      INSERT OR REPLACE INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
      VALUES (@id, @type, @context, @title, @body, @status, @priority, @position, @created_at, @updated_at, @due_at, @metadata)
    `)
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        const copy = { ...item, context: newContextSlug }
        stmtItem.run(copy)
      }
    }

    const stmtItemTag = db.prepare(`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)`)
    if (Array.isArray(data.item_tags)) {
      for (const it of data.item_tags) {
        stmtItemTag.run(it.item_id, it.tag_id)
      }
    }

    const stmtRelation = db.prepare(`
      INSERT OR REPLACE INTO relations (id, from_id, to_id, type)
      VALUES (@id, @from_id, @to_id, @type)
    `)
    if (Array.isArray(data.relations)) {
      for (const rel of data.relations) {
        stmtRelation.run(rel)
      }
    }

    // through the normaliser like any write, a file is only as trustworthy as whoever handed it over
    const stmtRenewal = db.prepare(`
      INSERT OR REPLACE INTO renewals (id, context, title, body, status, created_at, updated_at, metadata)
      VALUES (@id, @context, @title, @body, @status, @created_at, @updated_at, @metadata)
    `)
    if (Array.isArray(data.renewals)) {
      const now = Date.now()
      for (const r of data.renewals) {
        if (!r || typeof r.id !== 'string' || !r.id) continue
        stmtRenewal.run({
          id: r.id,
          context: newContextSlug,
          title: typeof r.title === 'string' ? r.title.slice(0, 200) : '',
          body: typeof r.body === 'string' ? r.body : '',
          status: r.status === 'cancelled' ? 'cancelled' : 'active',
          created_at: typeof r.created_at === 'number' ? r.created_at : now,
          updated_at: now,
          metadata: JSON.stringify(normalizeRenewal(r.metadata).meta)
        })
      }
    }

    // rewritten for the target workspace; missing from v1 exports
    if (data.settings && typeof data.settings === 'object') {
      const stmtSetting = db.prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      const entries = remapContextSettings(
        data.settings,
        data.context,
        newContextSlug,
        () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      )
      for (const entry of entries) {
        if (!isSecretSetting(entry.key)) stmtSetting.run(entry.key, entry.value)
      }
    }
  })()
}

/** tables whose rows say which workspace they belong to */
const CONTEXT_TABLES = ['items', 'focus_sessions', 'ai_memories', 'activity_tracking_logs', 'recurrences']

const LIST_KEY = 'contexts_list'
/** settings that hold one workspace's name as their whole value */
const SLUG_KEYS = ['active_context', 'default_context']

type ListEntry = { slug: string } & Record<string, unknown>

/** stored as the renderer writes it, a JSON string inside the JSON value */
export function readContextList(db: Database.Database): ListEntry[] | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(LIST_KEY) as { value: string } | undefined
  if (!row) return null
  try {
    let parsed: unknown = JSON.parse(row.value)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed.filter((e): e is ListEntry => !!e && typeof e.slug === 'string') : null
  } catch {
    return null
  }
}

const writeList = (db: Database.Database, list: ListEntry[]): void => {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(LIST_KEY, JSON.stringify(JSON.stringify(list)))
}

/** the workspaces this machine has right now, the ones a rename must never fold into another */
export function liveContextSlugs(db: Database.Database): Set<string> {
  return new Set((readContextList(db) ?? []).map(e => e.slug))
}

/** rows, settings, the list and the agent log follow the name; keepNewer keeps what is already under the new one */
function moveContext(db: Database.Database, oldSlug: string, newSlug: string, keepNewer: boolean, known: ListEntry[] | null = null): void {
  const from = directContextSettingKeys(oldSlug)
  const to = directContextSettingKeys(newSlug)
  const movedKey = (key: string): string => {
    const i = from.indexOf(key)
    return i < 0 ? key : to[i]
  }

  for (const table of CONTEXT_TABLES) {
    db.prepare(`UPDATE ${table} SET context = ? WHERE context = ?`).run(newSlug, oldSlug)
  }
  // renewals sync by updated_at, so the move has to count as a change
  db.prepare('UPDATE renewals SET context = ?, updated_at = ? WHERE context = ?').run(newSlug, Date.now(), oldSlug)

  // later walls are keyed by their own id and stay where they are; the board, layout and first wall move
  const read = db.prepare('SELECT value FROM app_settings WHERE key = ?')
  const write = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const remove = db.prepare('DELETE FROM app_settings WHERE key = ?')
  from.forEach((key, i) => {
    const row = read.get(key) as { value: string } | undefined
    if (!row) return
    // a deleted workspace of the same name leaves its settings behind; the live one wins
    if (!keepNewer || !read.get(to[i])) write.run(to[i], row.value)
    remove.run(key)
  })
  for (const key of SLUG_KEYS) {
    const row = read.get(key) as { value: string } | undefined
    if (row && row.value === JSON.stringify(oldSlug)) write.run(key, JSON.stringify(newSlug))
  }

  const list = readContextList(db)
  if (list?.some(e => e.slug === oldSlug)) {
    const hasNew = list.some(e => e.slug === newSlug)
    // this machine's own entry for the new name beats a stale one renamed in place
    const own = known?.find(e => e.slug === newSlug)
    writeList(db, list.flatMap(e => (e.slug !== oldSlug ? [e] : hasNew ? [] : [own ?? { ...e, slug: newSlug }])))
  }

  const entries = db.prepare('SELECT id, undo FROM mcp_activity WHERE context = ?').all(oldSlug) as { id: string; undo: string | null }[]
  const update = db.prepare('UPDATE mcp_activity SET context = ?, undo = ? WHERE id = ?')
  for (const entry of entries) {
    let undo = entry.undo
    try {
      const actions = undo ? (JSON.parse(undo) as Record<string, unknown>[]) : null
      if (Array.isArray(actions)) {
        undo = JSON.stringify(actions.map(a => ({
          ...a,
          ...(a.context === oldSlug ? { context: newSlug } : {}),
          ...(typeof a.key === 'string' ? { key: movedKey(a.key) } : {})
        })))
      }
    } catch {
      // an unreadable undo can't be replayed anyway, so it stays as it was
    }
    update.run(newSlug, undo, entry.id)
  }
}

/** a rename made here: everything moves, and the rename is kept so other machines can make it too */
export function renameContextData(db: Database.Database, oldSlug: string, newSlug: string, now = Date.now()): void {
  db.transaction(() => {
    moveContext(db, oldSlug, newSlug, false)
    db.prepare('INSERT INTO context_renames (id, from_slug, to_slug, renamed_at) VALUES (?, ?, ?, ?)').run(uuidv4(), oldSlug, newSlug, now)
  })()
}

const validRename = (r: unknown): r is ContextRename => {
  const o = r as Record<string, unknown>
  return !!o && typeof o.id === 'string' && typeof o.from_slug === 'string' && typeof o.to_slug === 'string' &&
    !!o.from_slug && !!o.to_slug && o.from_slug !== o.to_slug && Number.isFinite(o.renamed_at)
}

/** renames another machine made, each once and in the order they happened; inside the sync's own transaction */
export function replayContextRenames(db: Database.Database, incoming: unknown): number {
  if (!Array.isArray(incoming)) return 0
  const known = db.prepare('SELECT 1 FROM context_renames WHERE id = ?')
  const insert = db.prepare('INSERT INTO context_renames (id, from_slug, to_slug, renamed_at) VALUES (?, ?, ?, ?)')
  const fresh = incoming.filter(validRename).filter(r => !known.get(r.id)).sort((a, b) => a.renamed_at - b.renamed_at)
  for (const r of fresh) {
    insert.run(r.id, r.from_slug, r.to_slug, r.renamed_at)
    moveContext(db, r.from_slug, r.to_slug, false)
  }
  return fresh.length
}

/** what a machine that hadn't heard sent under an old name follows it; a name still live here is a new workspace */
export function followContextRenames(db: Database.Database, liveBefore: Set<string>, listBefore: ListEntry[] | null): void {
  const renames = db.prepare('SELECT * FROM context_renames ORDER BY renamed_at, rowid').all() as ContextRename[]
  for (const r of renames) {
    if (liveBefore.has(r.from_slug)) continue
    moveContext(db, r.from_slug, r.to_slug, true, listBefore)
  }
}

