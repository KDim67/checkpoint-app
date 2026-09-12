/**
 * What an external agent did through the MCP server. Without this, cards just
 * appeared on a board with nothing to say where they came from.
 *
 * An entry is one tool call, a sentence describing it, and where the change can
 * be reversed, the actions that put it back.
 *
 * Undo is stored rather than reconstructed later: the state needed to reverse a
 * call only exists at the moment of the call. Deriving it afterwards would be
 * guessing at what used to be true.
 */

/** A single reversing step. An entry's undo is an ordered list of these. */
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
  /**
   * Takes one item back off a wall. The wall is named by its storage key rather
   * than by workspace-and-id, because that key is what actually locates the
   * document, and it stays correct even if the wall is renamed afterwards.
   */
  | { kind: 'remove_wall_item'; key: string; itemId: string }

export interface McpActivityEntry {
  id: string
  /** The MCP tool that ran, e.g. `create_item`. */
  tool: string
  /** Workspace the change landed in, or null for tools that are not scoped. */
  context: string | null
  /** One sentence, already written for a human: "Created card X in Y". */
  summary: string
  /** Ordered reversing steps, or null when the call cannot be undone. */
  undo: McpUndoAction[] | null
  /** When this entry was reversed, or null while it still stands. */
  undoneAt: number | null
  createdAt: number
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Narrows one stored action, or returns null if it is not one we can run.
 *
 * These rows are replayed against the database, so an unrecognised or
 * half-formed action must be dropped rather than attempted. A `delete_item`
 * with no id would otherwise reach the delete path with an empty string.
 */
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
      // An empty body is a legitimate note, so only the title is required.
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

/**
 * Parses a stored undo payload.
 *
 * Returns null when nothing usable survives, which the UI reads as "this one
 * cannot be undone". Better than offering a button that would half-work. A
 * partially valid list is also rejected: running some of the steps would leave
 * the workspace in a state neither before nor after the original call.
 */
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

/** Tools that change something. Anything else is a read and is never recorded. */
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

/** Trims a title for use inside a one-line summary. */
export function shorten(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
