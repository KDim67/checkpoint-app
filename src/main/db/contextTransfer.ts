import type Database from 'better-sqlite3'
import type { Item, Tag, Relation, ContextExport } from '../../shared/types'
import { contextSettingKeys, remapContextSettings } from '../../shared/contextSettings'
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

  // A workspace is not only its rows. Its columns, background, swimlanes,
  // backlog layout and walls all live in app_settings, and an export without
  // them hands back the cards arranged on a board the user never configured.
  const settings: Record<string, string> = {}
  const readSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
  const collect = (key: string): void => {
    // Secrets are stored encrypted and belong to this machine, not to the
    // workspace. None of the keys below are secret; the guard is so that stays
    // true if one is ever added.
    if (isSecretSetting(key)) return
    const row = readSetting.get(key) as { value: string } | undefined
    if (row) settings[key] = row.value
  }

  // The index has to be read before the walls can be found: every wall after
  // the first is keyed by its own id rather than by the workspace.
  const storedIndex = (readSetting.get(wallIndexKey(context)) as { value: string } | undefined)?.value
  contextSettingKeys(context, storedIndex ?? null).forEach(collect)

  return {
    version: 2,
    context,
    items,
    tags,
    item_tags,
    relations,
    settings
  }
}

export function importContextData(db: Database.Database, newContextSlug: string, data: ContextExport): void {
  db.transaction(() => {
    // 1. Insert tags
    const stmtTag = db.prepare(`INSERT OR IGNORE INTO tags (id, name, color) VALUES (@id, @name, @color)`)
    if (Array.isArray(data.tags)) {
      for (const t of data.tags) {
        stmtTag.run(t)
      }
    }

    // 2. Insert items
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

    // 3. Insert item_tags
    const stmtItemTag = db.prepare(`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)`)
    if (Array.isArray(data.item_tags)) {
      for (const it of data.item_tags) {
        stmtItemTag.run(it.item_id, it.tag_id)
      }
    }

    // 4. Insert relations
    const stmtRelation = db.prepare(`
      INSERT OR REPLACE INTO relations (id, from_id, to_id, type)
      VALUES (@id, @from_id, @to_id, @type)
    `)
    if (Array.isArray(data.relations)) {
      for (const rel of data.relations) {
        stmtRelation.run(rel)
      }
    }

    // 5. The workspace's own settings, rewritten for the workspace being
    // imported into. Absent from a version 1 export, which still imports.
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
