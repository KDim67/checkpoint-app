/** apart from mcpServer, which loads lazily with the SDK: undo has to work with the server off */

import { v4 as uuidv4 } from 'uuid'
import { normalizeWallDoc } from '../shared/wallModel'
import {
  deleteItem,
  deleteRecurrence,
  deleteSubtask,
  updateSubtask,
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

/** the log answers "what just happened?" */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** never throws, a logging failure mustn't fail the tool call */
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
    case 'delete_recurrence':
      deleteRecurrence(action.id)
      break
    case 'delete_subtask':
      deleteSubtask(action.id)
      break
    case 'set_subtask_done':
      updateSubtask(action.id, { done: action.done })
      break
    case 'board_ops':
      applyBoardUndo(action)
      break
    case 'remove_wall_item': {
      // read back, the wall may have changed since and only the placement should reverse
      const doc = normalizeWallDoc(getSetting<unknown>(action.key, null))
      setSetting(action.key, { ...doc, items: doc.items.filter(i => i.id !== action.itemId) })
      break
    }
    case 'delete_note':
      // notes are async fs; fire and log so one slow write can't hold the reversal open
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

/** claim the row first, so a second click can't replay a delete onto a reused id */
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
    // claim stays: re-running a half-applied reversal repeats the steps that landed
    return { ok: false, reason: 'Undo failed partway. Check the log for details.' }
  }
}
