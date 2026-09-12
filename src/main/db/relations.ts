import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { Relation, RelationType } from '../../shared/types'
import { recordTombstone } from './tombstones'

let stmtGetRelations: Database.Statement
let stmtInsertRelation: Database.Statement
let stmtDeleteRelation: Database.Statement

export function prepareRelationStatements(db: Database.Database): void {
  stmtGetRelations = db.prepare(
    `SELECT * FROM relations WHERE from_id = ? OR to_id = ?`
  )
  stmtInsertRelation = db.prepare(
    `INSERT INTO relations (id, from_id, to_id, type) VALUES (@id, @from_id, @to_id, @type)`
  )
  stmtDeleteRelation = db.prepare(`DELETE FROM relations WHERE id = ?`)
}

export function getRelations(itemId: string): Relation[] {
  return stmtGetRelations.all(itemId, itemId) as Relation[]
}

export function createRelation(fromId: string, toId: string, type: RelationType): Relation {
  const id = uuidv4()
  stmtInsertRelation.run({ id, from_id: fromId, to_id: toId, type })
  return { id, from_id: fromId, to_id: toId, type }
}

export function deleteRelation(id: string): void {
  recordTombstone(id, 'relations')
  stmtDeleteRelation.run(id)
}
