import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { Tag, CreateTagPayload } from '../../shared/types'
import { recordTombstone } from './tombstones'

let stmtGetAllTags: Database.Statement
let stmtInsertTag: Database.Statement
let stmtUpdateTag: Database.Statement
let stmtDeleteTag: Database.Statement

export function prepareTagStatements(db: Database.Database): void {
  stmtGetAllTags = db.prepare(`SELECT * FROM tags ORDER BY name ASC`)
  stmtInsertTag = db.prepare(
    `INSERT INTO tags (id, name, color) VALUES (@id, @name, @color)`
  )
  stmtUpdateTag = db.prepare(`UPDATE tags SET name = @name, color = @color WHERE id = @id`)
  stmtDeleteTag = db.prepare(`DELETE FROM tags WHERE id = ?`)
}

export function getAllTags(): Tag[] {
  return stmtGetAllTags.all() as Tag[]
}

export function createTag(payload: CreateTagPayload): Tag {
  const id = uuidv4()
  stmtInsertTag.run({ id, name: payload.name, color: payload.color })
  return { id, name: payload.name, color: payload.color }
}

export function updateTag(id: string, payload: Partial<CreateTagPayload>): Tag {
  const existing = stmtGetAllTags.all().find((t: unknown) => (t as Tag).id === id) as Tag | undefined
  if (!existing) throw new Error(`Tag not found: ${id}`)
  const updated = { ...existing, ...payload }
  stmtUpdateTag.run(updated)
  return updated
}

export function deleteTag(id: string): void {
  recordTombstone(id, 'tags')
  stmtDeleteTag.run(id)
}
