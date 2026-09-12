import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { emitPluginEvent } from '../pluginEvents'
import type { FocusSession, CreateFocusSessionPayload } from '../../shared/types'

let stmtInsertFocusSession: Database.Statement
let stmtGetFocusSessions: Database.Statement

export function prepareFocusStatements(db: Database.Database): void {
  stmtInsertFocusSession = db.prepare(`
    INSERT INTO focus_sessions (id, context, duration_ms, completed_at, notes, tasks_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmtGetFocusSessions = db.prepare(`
    SELECT * FROM focus_sessions WHERE context = ? ORDER BY completed_at DESC
  `)
}

export function createFocusSession(payload: CreateFocusSessionPayload): FocusSession {
  const id = uuidv4()
  const completed_at = Date.now()
  stmtInsertFocusSession.run(
    id,
    payload.context,
    payload.duration_ms,
    completed_at,
    payload.notes,
    payload.tasks_json
  )
  emitPluginEvent('focus:completed', { context: payload.context, durationMs: payload.duration_ms })
  return {
    id,
    context: payload.context,
    duration_ms: payload.duration_ms,
    completed_at,
    notes: payload.notes,
    tasks_json: payload.tasks_json
  }
}

export function getFocusSessions(context: string): FocusSession[] {
  const rows = stmtGetFocusSessions.all(context) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    context: row.context as string,
    duration_ms: row.duration_ms as number,
    completed_at: row.completed_at as number,
    notes: row.notes as string,
    tasks_json: row.tasks_json as string
  }))
}
