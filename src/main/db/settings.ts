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

/** ask dbInstance, not the statement: it outlives the close finalized and throws */
function settingsReady(stmt: Database.Statement | undefined): boolean {
  return !!dbInstance && !!stmt
}

/** delete outright; an empty value still syncs and still shows in a dump */
export function deleteSetting(key: string): void {
  if (!settingsReady(stmtDeleteSetting)) return
  stmtDeleteSetting.run(key)
}

export function getSetting<T>(key: string, defaultValue: T): T {
  // default before initDb and after close, both happen at startup and shutdown
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
    // lazy like the entry point, so settings don't pull the watcher in at startup
    import('../clipboardWatcher')
      .then(({ setClipboardCaptureEnabled }) => setClipboardCaptureEnabled(value !== 'false'))
      .catch(err => console.error('[db] Failed to apply clipboard capture setting:', err))
  }
}
