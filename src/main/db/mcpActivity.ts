import { getDb } from './connection'

// prepared lazily, only used when the MCP server is on

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
  // rowid breaks ties within one ms, or an update could list before its create
  return getDb()
    .prepare(`SELECT * FROM mcp_activity ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(limit) as McpActivityRow[]
}

export function getMcpActivityById(id: string): McpActivityRow | null {
  return (getDb()
    .prepare(`SELECT * FROM mcp_activity WHERE id = ?`)
    .get(id) as McpActivityRow | undefined) ?? null
}

/** undone_at IS NULL makes undo idempotent; a replayed delete_item could hit a reused id */
export function markMcpActivityUndone(id: string, at: number): boolean {
  const result = getDb()
    .prepare(`UPDATE mcp_activity SET undone_at = ? WHERE id = ? AND undone_at IS NULL`)
    .run(at, id)
  return result.changes > 0
}

/** a convenience, not an audit */
export function pruneMcpActivity(olderThan: number): number {
  return getDb().prepare(`DELETE FROM mcp_activity WHERE created_at < ?`).run(olderThan).changes
}
