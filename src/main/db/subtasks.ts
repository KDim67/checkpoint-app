import { getDb } from './connection'

interface SubtaskRow {
  id: string
  item_id: string
  title: string
  done: number
  position: number
  created_at: number
}

export function getSubtasks(itemId: string): SubtaskRow[] {
  return getDb()
    .prepare(`SELECT * FROM subtasks WHERE item_id = ? ORDER BY position, created_at`)
    .all(itemId) as SubtaskRow[]
}

export function insertSubtask(row: SubtaskRow): void {
  getDb()
    .prepare(
      `INSERT INTO subtasks (id, item_id, title, done, position, created_at)
       VALUES (@id, @item_id, @title, @done, @position, @created_at)`
    )
    .run(row)
}

export function updateSubtask(id: string, patch: { title?: string; done?: boolean; position?: number }): void {
  const sets: string[] = []
  const args: Record<string, unknown> = { id }
  if (patch.title !== undefined) { sets.push('title = @title'); args.title = patch.title }
  if (patch.done !== undefined) { sets.push('done = @done'); args.done = patch.done ? 1 : 0 }
  if (patch.position !== undefined) { sets.push('position = @position'); args.position = patch.position }
  if (sets.length === 0) return
  getDb().prepare(`UPDATE subtasks SET ${sets.join(', ')} WHERE id = @id`).run(args)
}

export function deleteSubtask(id: string): void {
  getDb().prepare(`DELETE FROM subtasks WHERE id = ?`).run(id)
}
