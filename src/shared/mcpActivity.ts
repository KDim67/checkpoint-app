/**
 * The record of what an external agent did through the MCP server.
 *
 * The server exposes seven write tools and, until now, kept no trace of any of
 * them: cards appeared on a board with nothing to say where they came from. An
 * entry is one tool call, a sentence describing it, and, where the change can
 * be expressed in reverse, the actions that would put things back.
 *
 * Undo is stored as data rather than reconstructed later on purpose. The state
 * needed to reverse a call only exists at the moment of the call: the prior
 * field values, the note's previous contents, the inverse column operations.
 * Anything derived afterwards would be guessing at what used to be true.
 *
 * Pure, and in shared/, so the tests reach it without an Electron process.
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
 * half-formed action must be dropped rather than attempted, a `delete_item`
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
    default:
      return null
  }
}

/**
 * Parses a stored undo payload.
 *
 * Returns null when nothing usable survives, which the UI reads as "this one
 * cannot be undone", better than offering a button that would half-work. A
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
  'archive_item'
] as const

export type McpWriteTool = (typeof MCP_WRITE_TOOLS)[number]

export function isWriteTool(tool: string): tool is McpWriteTool {
  return (MCP_WRITE_TOOLS as readonly string[]).includes(tool)
}

/** Trims a title for use inside a one-line summary. */
export function shorten(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean
}
