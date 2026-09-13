/** one entry per tool call; undo stored at call time since that state is gone later */

/** one reversing step, an entry holds an ordered list */
export type McpUndoAction =
  | { kind: 'delete_item'; id: string }
  | { kind: 'restore_item'; id: string; fields: Record<string, unknown> }
  | { kind: 'board_ops'; context: string; operations: unknown[] }
  | { kind: 'delete_note'; title: string }
  | { kind: 'write_note'; title: string; content: string }
  | { kind: 'delete_tag'; id: string }
  | { kind: 'delete_relation'; id: string }
  | { kind: 'delete_recurrence'; id: string }
  | { kind: 'delete_subtask'; id: string }
  | { kind: 'set_subtask_done'; id: string; done: boolean }
  /** by storage key, which survives wall renames */
  | { kind: 'remove_wall_item'; key: string; itemId: string }

export interface McpActivityEntry {
  id: string
  /** e.g. create_item */
  tool: string
  /** null for unscoped tools */
  context: string | null
  /** already human-readable */
  summary: string
  /** null when it can't be undone */
  undo: McpUndoAction[] | null
  /** null while it stands */
  undoneAt: number | null
  createdAt: number
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** replayed against the db, so unknown or half-formed actions are dropped */
export function normalizeUndoAction(raw: unknown): McpUndoAction | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  switch (o.kind) {
    case 'delete_item':
      return str(o.id) ? { kind: 'delete_item', id: str(o.id) } : null
    case 'restore_item':
      return str(o.id) && o.fields && typeof o.fields === 'object'
        ? { kind: 'restore_item', id: str(o.id), fields: o.fields as Record<string, unknown> }
        : null
    case 'board_ops':
      return str(o.context) && Array.isArray(o.operations)
        ? { kind: 'board_ops', context: str(o.context), operations: o.operations }
        : null
    case 'delete_note':
      return str(o.title) ? { kind: 'delete_note', title: str(o.title) } : null
    case 'write_note':
      // an empty body is a legit note
      return str(o.title)
        ? { kind: 'write_note', title: str(o.title), content: str(o.content) }
        : null
    case 'delete_tag':
      return str(o.id) ? { kind: 'delete_tag', id: str(o.id) } : null
    case 'delete_relation':
      return str(o.id) ? { kind: 'delete_relation', id: str(o.id) } : null
    case 'delete_recurrence':
      return str(o.id) ? { kind: 'delete_recurrence', id: str(o.id) } : null
    case 'remove_wall_item':
      return str(o.key) && str(o.itemId)
        ? { kind: 'remove_wall_item', key: str(o.key), itemId: str(o.itemId) }
        : null
    case 'delete_subtask':
      return str(o.id) ? { kind: 'delete_subtask', id: str(o.id) } : null
    case 'set_subtask_done':
      return str(o.id) && typeof o.done === 'boolean'
        ? { kind: 'set_subtask_done', id: str(o.id), done: o.done }
        : null
    default:
      return null
  }
}

/** partial lists rejected, running some steps leaves neither state */
export function normalizeUndo(raw: unknown): McpUndoAction[] | null {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const actions: McpUndoAction[] = []
  for (const entry of parsed) {
    const action = normalizeUndoAction(entry)
    if (!action) return null
    actions.push(action)
  }
  return actions
}

/** everything else is a read, never recorded */
export const MCP_WRITE_TOOLS = [
  'create_item',
  'update_item',
  'configure_board',
  'write_note',
  'create_tag',
  'link_items',
  'archive_item',
  'create_recurrence',
  'delete_recurrence',
  'add_subtask',
  'set_subtask_done'
] as const

type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number]

export function isWriteTool(tool: string): tool is McpWriteTool {
  return (MCP_WRITE_TOOLS as readonly string[]).includes(tool)
}

/** for one-line summaries */
export function shorten(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
