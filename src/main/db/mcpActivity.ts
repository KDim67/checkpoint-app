import { getDb } from './connection'

// A record of what an external agent changed. Prepared lazily rather than in the
// init block because these run rarely, only when the MCP server is switched on,
// and there is no reason to pay for them on every launch.

interface McpActivityRow {
  id: string
  tool: string
  context: string | null
  summary: string
  undo: string | null
  undone_at: number | null
  created_at: number
}

export function insertMcpActivity(row: McpActivityRow): void {
  getDb()
    .prepare(
      `INSERT INTO mcp_activity (id, tool, context, summary, undo, undone_at, created_at)
       VALUES (@id, @tool, @context, @summary, @undo, @undone_at, @created_at)`
    )
    .run(row)
}

export function getMcpActivity(limit = 50): McpActivityRow[] {
  // rowid breaks the tie. An agent can easily make several writes inside one
  // millisecond, and on created_at alone SQLite is free to return those in any
  // order, so the log would show a card being updated before it was created.
  return getDb()
    .prepare(`SELECT * FROM mcp_activity ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(limit) as McpActivityRow[]
}

export function getMcpActivityById(id: string): McpActivityRow | null {
  return (getDb()
    .prepare(`SELECT * FROM mcp_activity WHERE id = ?`)
    .get(id) as McpActivityRow | undefined) ?? null
}

/**
 * Stamps an entry as reversed.
 *
 * The guard on `undone_at IS NULL` is what makes undo idempotent: two clicks on
 * the same row, or a click racing a sync, would otherwise replay the reversing
 * actions twice, and replaying a `delete_item` that already ran would go on to
 * delete whatever later took that id.
 */
export function markMcpActivityUndone(id: string, at: number): boolean {
  const result = getDb()
    .prepare(`UPDATE mcp_activity SET undone_at = ? WHERE id = ? AND undone_at IS NULL`)
    .run(at, id)
  return result.changes > 0
}

/** Drops entries older than the cutoff. The log is a convenience, not an audit. */
export function pruneMcpActivity(olderThan: number): number {
  return getDb().prepare(`DELETE FROM mcp_activity WHERE created_at < ?`).run(olderThan).changes
}
