import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { getDb, prepareOnce } from './connection'

let stmtInsertActivityLog: Database.Statement

export function prepareActivityStatements(db: Database.Database): void {
  stmtInsertActivityLog = db.prepare(`
    INSERT INTO activity_tracking_logs (id, context, window_title, process_name, duration_ms, captured_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
}

export function insertActivityLog(context: string, windowTitle: string, processName: string, durationMs: number): void {
  const id = uuidv4()
  const capturedAt = Date.now()
  stmtInsertActivityLog.run(id, context, windowTitle, processName, durationMs, capturedAt)
}

export function getActivityStats(
  context: string | null,
  timeStart: number,
  timeEnd: number
): {
  totalDurationMs: number
  byProcess: Array<{ processName: string; durationMs: number }>
  byContext: Array<{ context: string; durationMs: number }>
  byTitle: Array<{ windowTitle: string; processName: string; durationMs: number }>
} {
  const isContextFilter = context && context !== 'all' && context !== ''
  const contextFilter = isContextFilter ? 'AND context = ?' : ''
  const params: (string | number)[] = [timeStart, timeEnd]
  if (isContextFilter) params.push(context)

  const db = getDb()
  // 1. Total duration
  const totalRow = prepareOnce(db, `
    SELECT SUM(duration_ms) as total 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
  `).get(...params) as { total: number | null }
  const totalDurationMs = totalRow?.total || 0

  // 2. By Process
  const byProcessRows = prepareOnce(db, `
    SELECT process_name as processName, SUM(duration_ms) as durationMs 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
    GROUP BY process_name
    ORDER BY durationMs DESC
    LIMIT 15
  `).all(...params) as Array<{ processName: string; durationMs: number }>

  // 3. By Context
  const byContextRows = prepareOnce(db, `
    SELECT context, SUM(duration_ms) as durationMs 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
    GROUP BY context
    ORDER BY durationMs DESC
  `).all(...params) as Array<{ context: string; durationMs: number }>

  // 4. By Title
  const byTitleRows = prepareOnce(db, `
    SELECT window_title as windowTitle, process_name as processName, SUM(duration_ms) as durationMs 
    FROM activity_tracking_logs 
    WHERE captured_at >= ? AND captured_at <= ? ${contextFilter}
    GROUP BY window_title, process_name
    ORDER BY durationMs DESC
    LIMIT 20
  `).all(...params) as Array<{ windowTitle: string; processName: string; durationMs: number }>

  return {
    totalDurationMs,
    byProcess: byProcessRows,
    byContext: byContextRows,
    byTitle: byTitleRows
  }
}
