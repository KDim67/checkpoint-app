import type { RemoteMutation } from '../../shared/collabProtocol'
import type { Item, Tag, Relation, SyncPayload } from '../../shared/types'
import { getDb } from './connection'
import { rebalancePositions } from './items'

export function applyBoardBaselineTx(
  context: string,
  items: Item[],
  tags: Tag[],
  itemTags: SyncPayload['item_tags'],
  relations: Relation[]
): void {
  const db = getDb()
  db.transaction(() => {
    // 1. Delete all items in context of type 'card' or 'task'
    db.prepare("DELETE FROM items WHERE context = ? AND type IN ('card', 'task')").run(context)

    // 2. Insert tags
    const stmtTag = db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)')
    for (const t of tags) {
      stmtTag.run(t.id, t.name, t.color)
    }

    // 3. Insert items
    const stmtItem = db.prepare(`
      INSERT OR REPLACE INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of items) {
      stmtItem.run(
        item.id,
        item.type,
        item.context,
        item.title,
        item.body,
        item.status,
        item.priority,
        item.position,
        item.created_at,
        item.updated_at,
        item.due_at || null,
        item.metadata || '{}'
      )
    }

    // 4. Insert item_tags
    const stmtItemTag = db.prepare('INSERT OR REPLACE INTO item_tags (item_id, tag_id) VALUES (?, ?)')
    for (const it of itemTags) {
      stmtItemTag.run(it.item_id, it.tag_id)
    }

    // 5. Insert relations
    const stmtRelation = db.prepare('INSERT OR REPLACE INTO relations (id, from_id, to_id, type) VALUES (?, ?, ?, ?)')
    for (const r of relations) {
      stmtRelation.run(r.id, r.from_id, r.to_id, r.type)
    }
  })()
}

export function applyRemoteMutationTx(mutation: RemoteMutation): void {
  const db = getDb()
  const { type } = mutation

  if (type === 'createItem' || type === 'updateItem') {
    const { item, tagIds } = mutation
    db.transaction(() => {
      db.prepare(`
        INSERT OR REPLACE INTO items (id, type, context, title, body, status, priority, position, created_at, updated_at, due_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.type,
        item.context,
        item.title,
        item.body,
        item.status,
        item.priority,
        item.position,
        item.created_at,
        item.updated_at,
        item.due_at || null,
        item.metadata || '{}'
      )

      if (tagIds) {
        db.prepare('DELETE FROM item_tags WHERE item_id = ?').run(item.id)
        const stmtTag = db.prepare('INSERT OR REPLACE INTO item_tags (item_id, tag_id) VALUES (?, ?)')
        for (const tagId of tagIds) {
          stmtTag.run(item.id, tagId)
        }
      }
    })()
  } else if (type === 'deleteItem') {
    const { id } = mutation
    db.prepare('DELETE FROM items WHERE id = ?').run(id)
  } else if (type === 'createTag') {
    const { tag } = mutation
    db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)')
      .run(tag.id, tag.name, tag.color)
  } else if (type === 'updateTag') {
    const { tag } = mutation
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
      .run(tag.name, tag.color, tag.id)
  } else if (type === 'deleteTag') {
    const { id } = mutation
    db.prepare('DELETE FROM tags WHERE id = ?').run(id)
  } else if (type === 'createRelation') {
    const { relation } = mutation
    db.prepare('INSERT OR REPLACE INTO relations (id, from_id, to_id, type) VALUES (?, ?, ?, ?)')
      .run(relation.id, relation.from_id, relation.to_id, relation.type)
  } else if (type === 'deleteRelation') {
    const { id } = mutation
    db.prepare('DELETE FROM relations WHERE id = ?').run(id)
  } else if (type === 'bulkUpdateItems') {
    // Built from whichever fields the patch actually carries, matching the
    // local handler for the same payload. A fixed SET clause would write nulls
    // over the fields the user did not touch.
    const { ids, patch } = mutation.payload
    const setFields: string[] = []
    const params: Record<string, unknown> = { updated_at: Date.now() }

    if (patch.status !== undefined) { setFields.push('status = @status'); params.status = patch.status }
    if (patch.priority !== undefined) { setFields.push('priority = @priority'); params.priority = patch.priority }
    if (patch.context !== undefined) { setFields.push('context = @context'); params.context = patch.context }

    if (setFields.length > 0) {
      setFields.push('updated_at = @updated_at')
      const stmt = db.prepare(`UPDATE items SET ${setFields.join(', ')} WHERE id = @id`)
      db.transaction(() => {
        for (const id of ids) stmt.run({ ...params, id })
      })()
    }
  } else if (type === 'bulkDeleteItems') {
    const { ids } = mutation
    db.transaction(() => {
      const stmt = db.prepare('DELETE FROM items WHERE id = ?')
      for (const id of ids) {
        stmt.run(id)
      }
    })()
  } else if (type === 'rebalancePositions') {
    const { context, status } = mutation
    rebalancePositions(db, context, status)
  }
}
