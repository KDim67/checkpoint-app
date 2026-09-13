/** better-sqlite3, rebuilt for electron's ABI on postinstall; prepare once in initDb, never per call */

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
  getAllItems,
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

/** re-exported: the renderer needs it and can't import from main */
export type { RemoteMutation } from '../../shared/collabProtocol'

export function initDb(dataPath: string): Database.Database {
  const db = openDb(dataPath)

  db.exec(SCHEMA_SQL)
  rebuildItemsTableIfLegacyCheck(db)
  runMigrations(db)

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
