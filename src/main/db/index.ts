/** better-sqlite3, rebuilt for electron's ABI on postinstall; prepare once in initDb, never per call */

import type Database from 'better-sqlite3'
import { openDb } from './connection'
import { SCHEMA_SQL } from './schema'
import { ensureAgreedFieldsColumn } from './connectionLinks'
import { encryptLegacyPlaintextSecrets, rebuildItemsTableIfLegacyCheck, runMigrations, SCHEMA_VERSION, storedSchemaVersion } from './migrations'
import { prepareItemStatements } from './items'
import { prepareTagStatements } from './tags'
import { prepareSettingStatements } from './settings'
import { prepareRelationStatements } from './relations'
import { prepareFocusStatements } from './focus'
import { prepareClipboardStatements } from './clipboard'
import { prepareActivityStatements } from './activity'
import { prepareTombstoneStatements } from './tombstones'

export { closeDb, discardDb, getDb } from './connection'
export { SCHEMA_VERSION } from './migrations'
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
export { clearTombstone, recordTombstone } from './tombstones'
export { getAgreed, getAgreedFields, listAgreed, setAgreed, setAgreedFields, type Agreed, type AgreedFields, type AgreedRow } from './connectionLinks'
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
export {
  exportContextData,
  followContextRenames,
  importContextData,
  liveContextSlugs,
  readContextList,
  renameContextData,
  replayContextRenames
} from './contextTransfer'
export { deleteRenewalRow, getRenewalRow, insertRenewalRow, listRenewalRows, updateRenewalRow } from './renewals'

/** re-exported: the renderer needs it and can't import from main */
export type { RemoteMutation } from '../../shared/collabProtocol'

/** data saved by a newer Checkpoint; older code could misread or overwrite what it doesn't know */
export class NewerDatabaseError extends Error {
  constructor(readonly found: number, readonly understood: number) {
    super(`The database is at schema ${found} and this version understands up to ${understood}`)
    this.name = 'NewerDatabaseError'
  }
}

export interface OpenHooks {
  /** handed the database as the last version left it, just before this one changes it */
  beforeMigrating?: (db: Database.Database, from: number) => void
}

const hasTables = (db: Database.Database): boolean =>
  ((db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n) > 0

export function initDb(dataPath: string, { beforeMigrating }: OpenHooks = {}): Database.Database {
  const db = openDb(dataPath)

  // checked before anything below writes, so a newer version finds its data as it left it
  const stored = storedSchemaVersion(db)
  if (stored > SCHEMA_VERSION) throw new NewerDatabaseError(stored, SCHEMA_VERSION)
  // a brand new file has nothing to keep
  if (beforeMigrating && stored < SCHEMA_VERSION && hasTables(db)) {
    try {
      beforeMigrating(db, stored)
    } catch (err) {
      // the migration is all or nothing, so it goes ahead; refusing would lock people out over a full disk
      console.error('[db] Could not copy the database before updating it:', err)
    }
  }

  db.exec(SCHEMA_SQL)
  ensureAgreedFieldsColumn(db)
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
