/**
 * SQLite Database Layer. Checkpoint
 *
 * Uses better-sqlite3 (synchronous API, native C++ module).
 * Must be rebuilt for Electron's Node ABI via electron-rebuild (postinstall script).
 *
 * All db.prepare() calls happen once at initDb() time, stored as module-level
 * prepared statements. Query functions call .run()/.get()/.all() on them,
 * never call db.prepare() inside a per-call function.
 */

import type Database from 'better-sqlite3'
import { openDb } from './connection'
import { SCHEMA_SQL } from './schema'
import { encryptLegacyPlaintextSecrets, rebuildItemsTableIfLegacyCheck, runMigrations } from './migrations'
import { prepareItemStatements } from './items'
import { prepareTagStatements } from './tags'
import { prepareSettingStatements } from './settings'
import { prepareRelationStatements } from './relations'
import { prepareFocusStatements } from './focus'
import { prepareClipboardStatements } from './clipboard'
import { prepareActivityStatements } from './activity'
import { prepareTombstoneStatements } from './tombstones'

export { closeDb, discardDb, getDb } from './connection'
export {
  getItemsPaginated,
  getAllItemsForExport,
  getItemById,
  createItem,
  updateItem,
  setRecurrenceInstanceClosedHandler,
  deleteItem,
  bulkDeleteItems,
  getContextSlugs,
  rebalancePositions
} from './items'
export { recordTombstone } from './tombstones'
export { applyBoardBaselineTx, applyRemoteMutationTx } from './remote'
export { getAllTags, createTag, updateTag, deleteTag } from './tags'
export { deleteSetting, getSetting, setSetting } from './settings'
export { getRelations, createRelation, deleteRelation } from './relations'
export { getSubtasks, insertSubtask, updateSubtask, deleteSubtask } from './subtasks'
export {
  insertMcpActivity,
  getMcpActivity,
  getMcpActivityById,
  markMcpActivityUndone,
  pruneMcpActivity
} from './mcpActivity'
export {
  insertRecurrence,
  getRecurrences,
  getRecurrenceById,
  getDueRecurrences,
  setRecurrenceNextDue,
  setRecurrenceActive,
  deleteRecurrence,
  hasOpenRecurrenceInstance,
  type RecurrenceRow
} from './recurrences'
export { searchItems, queryTasks } from './search'
export { createFocusSession, getFocusSessions } from './focus'
export {
  getClipboardHistory,
  recordClipboardCopy,
  createClipboardSnippet,
  toggleClipboardPin,
  updateClipboardLabel,
  deleteClipboardItem,
  restoreClipboardItem,
  clearClipboardHistory
} from './clipboard'
export { insertActivityLog, getActivityStats } from './activity'
export { exportContextData, importContextData } from './contextTransfer'

/**
 * Re-exported rather than declared here: the renderer needs this type to talk
 * to a peer, and it cannot import from the main process. The definition and its
 * validator live together in shared/collabProtocol.ts.
 */
export type { RemoteMutation } from '../../shared/collabProtocol'

// Init

export function initDb(dataPath: string): Database.Database {
  const db = openDb(dataPath)

  // Apply schema and migrations
  db.exec(SCHEMA_SQL)
  rebuildItemsTableIfLegacyCheck(db)
  runMigrations(db)

  // Prepare all statements once at init time
  prepareItemStatements(db)
  prepareTagStatements(db)
  prepareSettingStatements(db)
  prepareRelationStatements(db)
  prepareFocusStatements(db)
  prepareClipboardStatements(db)
  prepareActivityStatements(db)
  prepareTombstoneStatements(db)

  encryptLegacyPlaintextSecrets(db)

  return db
}
