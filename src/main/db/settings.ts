import type Database from 'better-sqlite3'
import { isSecretSetting, encryptSecret, decryptSecret } from '../secureSettings'
import { updateNativeTitleBarFromSettings } from '../titleBarSync'
import { dbInstance } from './connection'

let stmtGetSetting: Database.Statement
let stmtSetSetting: Database.Statement
let stmtDeleteSetting: Database.Statement

export function prepareSettingStatements(db: Database.Database): void {
  stmtGetSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
  stmtSetSetting = db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  stmtDeleteSetting = db.prepare(`DELETE FROM app_settings WHERE key = ?`)
}

/**
 * Whether a settings statement can actually be run right now.
 *
 * Checking the statement alone was not enough. It is still there after the
 * connection closes, only finalized, so a read during shutdown threw
 * "statement has been finalized" instead of falling back to the default the
 * comment promised. `dbInstance` is the thing that says whether there is a
 * database, so it is what gets asked.
 */
function settingsReady(stmt: Database.Statement | undefined): boolean {
  return !!dbInstance && !!stmt
}

/**
 * Removes a setting outright. Writing an empty value would leave a row that
 * still syncs and still shows up in a settings dump; a deleted wall should
 * leave nothing behind.
 */
export function deleteSetting(key: string): void {
  if (!settingsReady(stmtDeleteSetting)) return
  stmtDeleteSetting.run(key)
}

export function getSetting<T>(key: string, defaultValue: T): T {
  // Before initDb and after the connection closes, a read gets the default
  // rather than a crash. Both happen: settings are read during startup, and
  // during the shutdown that runs after closeDb.
  if (!settingsReady(stmtGetSetting)) return defaultValue
  const row = stmtGetSetting.get(key) as { value: string } | undefined
  if (!row) return defaultValue
  const serialized = isSecretSetting(key) ? decryptSecret(row.value) : row.value
  try {
    return JSON.parse(serialized) as T
  } catch {
    return defaultValue
  }
}

export function setSetting(key: string, value: unknown): void {
  if (!settingsReady(stmtSetSetting)) {
    console.error('[db] Dropped setting write with no open database:', key)
    return
  }
  const serialized = JSON.stringify(value)
  stmtSetSetting.run(key, isSecretSetting(key) ? encryptSecret(serialized) : serialized)
  if (key === 'app_theme') {
    try {
      updateNativeTitleBarFromSettings(value as string)
    } catch (err) {
      console.error('[db] Failed to sync titlebar overlay:', err)
    }
  }
  if (key === 'feature_view_clipboard') {
    // Imported lazily, the same way the entry point loads it, so settings do
    // not pull the watcher in at startup.
    import('../clipboardWatcher')
      .then(({ setClipboardCaptureEnabled }) => setClipboardCaptureEnabled(value !== 'false'))
      .catch(err => console.error('[db] Failed to apply clipboard capture setting:', err))
  }
}
