import { getDb } from './db'
import type { AnalyticsData } from '../shared/types'
import type Database from 'better-sqlite3'

let stmtFocusStats: Database.Statement
let stmtWeeklyTasks: Database.Statement
let stmtLogHeatmap: Database.Statement
let stmtMostUsedTags: Database.Statement
let stmtColumnTime: Database.Statement
let stmtRecentFocus: Database.Statement
let stmtActivityAllocation: Database.Statement
let initialized = false

/**
 * Initializes prepared statements once db is ready.
 */
function initStatements(): void {
  if (initialized) return
  const db = getDb()

  stmtFocusStats = db.prepare(`
    SELECT 
      COUNT(*) as totalSessions,
      COALESCE(SUM(duration_ms), 0) / 60000.0 as totalDurationMins,
      COALESCE(AVG(duration_ms), 0) / 60000.0 as avgSessionMins
    FROM focus_sessions
  `)

  stmtWeeklyTasks = db.prepare(`
    SELECT 
      strftime('%Y-W%W', datetime(updated_at / 1000, 'unixepoch')) as week,
      COUNT(*) as count
    FROM items
    WHERE status = 'done' AND type IN ('task', 'card')
    GROUP BY week
    ORDER BY week ASC
    LIMIT 8
  `)

  stmtLogHeatmap = db.prepare(`
    SELECT 
      date(created_at / 1000, 'unixepoch') as date,
      COUNT(*) as count
    FROM items
    WHERE type = 'log' AND created_at >= ?
    GROUP BY date
    ORDER BY date ASC
  `)

  stmtMostUsedTags = db.prepare(`
    SELECT t.name, t.color, COUNT(*) as count
    FROM item_tags it
    INNER JOIN tags t ON it.tag_id = t.id
    GROUP BY t.id
    ORDER BY count DESC
    LIMIT 6
  `)

  stmtColumnTime = db.prepare(`
    SELECT 
      status as column,
      AVG(updated_at - created_at) as avgMs
    FROM items
    WHERE type IN ('task', 'card')
    GROUP BY status
  `)

  stmtRecentFocus = db.prepare(`
    SELECT completed_at, duration_ms, notes, context
    FROM focus_sessions
    ORDER BY completed_at DESC
    LIMIT 10
  `)

  stmtActivityAllocation = db.prepare(`
    SELECT context, SUM(duration_ms) / 60000.0 as durationMins
    FROM activity_tracking_logs
    WHERE captured_at >= ?
    GROUP BY context
    ORDER BY durationMins DESC
  `)

  initialized = true
}

/**
 * Executes aggregate queries to compile statistics on tasks, logs, focus, and tags.
 */
export function getAnalyticsData(): AnalyticsData {
  initStatements()

  const focusStatsRow = stmtFocusStats.get() as { totalSessions: number; totalDurationMins: number; avgSessionMins: number }
  const weeklyRows = stmtWeeklyTasks.all() as Array<{ week: string; count: number }>
  
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
  const heatmapRows = stmtLogHeatmap.all(oneYearAgo) as Array<{ date: string; count: number }>
  const tagRows = stmtMostUsedTags.all() as Array<{ name: string; color: string; count: number }>
  const columnRows = stmtColumnTime.all() as Array<{ column: string; avgMs: number }>
  const focusLogRows = stmtRecentFocus.all() as Array<{ completed_at: number; duration_ms: number; notes: string; context: string }>
  
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const activityRows = stmtActivityAllocation.all(sevenDaysAgo) as Array<{ context: string; durationMins: number }>

  return {
    focusStats: {
      totalSessions: focusStatsRow?.totalSessions || 0,
      totalDurationMins: Math.round(focusStatsRow?.totalDurationMins || 0),
      avgSessionMins: Math.round(focusStatsRow?.avgSessionMins || 0)
    },
    tasksCompletedWeekly: weeklyRows,
    logHeatmap: heatmapRows,
    mostUsedTags: tagRows,
    columnTime: columnRows,
    recentFocusSessions: focusLogRows.map(row => ({
      completedAt: row.completed_at,
      durationMinutes: Math.round(row.duration_ms / 60000),
      notes: row.notes,
      context: row.context
    })),
    activityAllocation: activityRows.map(row => ({
      context: row.context,
      durationMins: Math.round(row.durationMins)
    }))
  }
}
