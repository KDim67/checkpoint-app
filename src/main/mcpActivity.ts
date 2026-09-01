/**
 * Recording and reversing of MCP writes.
 *
 * Deliberately a separate module from mcpServer.ts. That file is imported
 * dynamically so the MCP SDK, which drags in express and hono, stays out of
 * the startup chunk, and undo has to keep working when the server is switched
 * off: yesterday's agent writes are exactly the ones you want to reverse today.
 * Nothing here imports the SDK.
 */

import { v4 as uuidv4 } from 'uuid'
import {
  deleteItem,
  deleteRelation,
  deleteTag,
  getMcpActivity,
  getMcpActivityById,
  getSetting,
  insertMcpActivity,
  markMcpActivityUndone,
  pruneMcpActivity,
  setSetting,
  updateItem,
  getDb
} from './db'
import { deleteNote, writeNote } from './notesFsService'
import { applyConfigOps, normalizeConfigUpdate } from '../shared/boardOps'
import { boardConfigKey, normalizeBoardConfig } from '../shared/boardModel'
import {
  normalizeUndo,
  type McpActivityEntry,
  type McpUndoAction
} from '../shared/mcpActivity'
import type { Item } from '../shared/types'

/** How long entries are kept. The log exists to answer "what just happened?". */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Writes one entry.
 *
 * Never throws: a failure to record must not fail the tool call that triggered
 * it. An agent losing a card because the log was unwritable would be a far worse
 * outcome than a missing row.
 */
export function recordMcpActivity(
  tool: string,
  context: string | null,
  summary: string,
  undo: McpUndoAction[] | null
): void {
  try {
    const now = Date.now()
    insertMcpActivity({
      id: uuidv4(),
      tool,
      context,
      summary,
      undo: undo && undo.length > 0 ? JSON.stringify(undo) : null,
      undone_at: null,
      created_at: now
    })
    pruneMcpActivity(now - RETENTION_MS)
  } catch (err) {
    console.error('[mcp-activity] Could not record write:', err)
  }
}

export function listMcpActivity(limit = 50): McpActivityEntry[] {
  return getMcpActivity(limit).map(row => ({
    id: row.id,
    tool: row.tool,
    context: row.context,
    summary: row.summary,
    undo: normalizeUndo(row.undo),
    undoneAt: row.undone_at,
    createdAt: row.created_at
  }))
}

function runUndoAction(action: McpUndoAction): void {
  switch (action.kind) {
    case 'delete_item':
      deleteItem(action.id)
      break
    case 'restore_item':
      updateItem(getDb(), action.id, action.fields as Partial<Item>)
      break
    case 'delete_tag':
      deleteTag(action.id)
      break
    case 'delete_relation':
      deleteRelation(action.id)
      break
    case 'board_ops':
      applyBoardUndo(action)
      break
    case 'delete_note':
      // Notes are filesystem-backed and therefore async, unlike everything else
      // here. Fired and logged rather than awaited so one slow write cannot hold
      // the rest of the reversal open; the failure surfaces in the console.
      deleteNote(action.title).catch(err =>
        console.error('[mcp-activity] Could not delete note during undo:', err)
      )
      break
    case 'write_note':
      writeNote(action.title, action.content).catch(err =>
        console.error('[mcp-activity] Could not restore note during undo:', err)
      )
      break
  }
}

function applyBoardUndo(action: Extract<McpUndoAction, { kind: 'board_ops' }>): void {
  const normalized = normalizeConfigUpdate({ operations: action.operations })
  if (!normalized) return

  const stored = getSetting<string>(boardConfigKey(action.context), '')
  const config = normalizeBoardConfig(stored || null)
  const applied = applyConfigOps(config, normalized.operations)
  setSetting(boardConfigKey(action.context), applied.next)
}

/**
 * Reverses one entry.
 *
 * The row is claimed before any action runs. Marking it undone first means a
 * second click finds it already claimed and does nothing, rather than replaying
 * a delete against an id something else may since have taken.
 */
export function undoMcpActivity(id: string): { ok: true } | { ok: false; reason: string } {
  const row = getMcpActivityById(id)
  if (!row) return { ok: false, reason: 'That entry is no longer in the log.' }
  if (row.undone_at !== null) return { ok: false, reason: 'That change was already undone.' }

  const actions = normalizeUndo(row.undo)
  if (!actions) return { ok: false, reason: 'This change cannot be undone.' }

  if (!markMcpActivityUndone(id, Date.now())) {
    return { ok: false, reason: 'That change was already undone.' }
  }

  try {
    for (const action of actions) runUndoAction(action)
    return { ok: true }
  } catch (err) {
    console.error('[mcp-activity] Undo failed partway:', err)
    // The claim is left in place. Re-running a half-applied reversal is more
    // dangerous than leaving it: the steps that did land would run a second time.
    return { ok: false, reason: 'Undo failed partway. Check the log for details.' }
  }
}
