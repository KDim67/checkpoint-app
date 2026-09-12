import { join } from 'path'
import fs from 'fs'
import zlib from 'zlib'
import { pipeline } from 'stream/promises'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { getDb, getSetting, setSetting, initDb, discardDb } from './db'

let backupTimer: NodeJS.Timeout | null = null
let initialCheckTimer: NodeJS.Timeout | null = null
let isBackingUp = false

/**
 * Compresses to a scratch name and moves it into place only once it is whole.
 *
 * Writing straight to the final name meant a failure part way through, a full
 * disk or a killed process, left a truncated file wearing a real backup's name.
 * It listed as a backup, it counted against the retention cap, and so it could
 * push a good backup out of the vault. A rename within one directory is atomic,
 * so a file under the final name is now always a complete one.
 */
async function compressFile(sourcePath: string, destinationPath: string): Promise<void> {
  const partial = `${destinationPath}.partial`
  try {
    const sourceStream = fs.createReadStream(sourcePath)
    const destStream = fs.createWriteStream(partial)
    const gzip = zlib.createGzip()
    await pipeline(sourceStream, gzip, destStream)
    fs.renameSync(partial, destinationPath)
  } catch (err) {
    try {
      if (fs.existsSync(partial)) fs.unlinkSync(partial)
    } catch (cleanupErr) {
      console.error('Failed to remove a partial backup:', cleanupErr)
    }
    throw err
  }
}

async function decompressFile(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStream = fs.createReadStream(sourcePath)
  const destStream = fs.createWriteStream(destinationPath)
  const gunzip = zlib.createGunzip()
  await pipeline(sourceStream, gunzip, destStream)
}

export function getBackupDir(): string {
  const customPath = getSetting<string>('backup_path', '')
  if (customPath && customPath.trim() !== '') {
    const resolved = customPath.trim()
    try {
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true })
      }
      return resolved
    } catch (err) {
      console.warn(`Custom backup path "${resolved}" is not writable, falling back to default. Error:`, err)
    }
  }

  const defaultDir = join(app.getPath('userData'), 'backups')
  try {
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true })
    }
  } catch (err) {
    console.error('Failed to create default backups directory:', err)
  }
  return defaultDir
}

/**
 * What a file in the vault is.
 *
 * `scheduled` is the rolling automatic snapshot. `preRestore` is the copy taken
 * of the live database immediately before a restore overwrites it, so a restore
 * chosen by mistake can be undone.
 */
type BackupKind = 'scheduled' | 'preRestore'

const PREFIXES: Record<BackupKind, string> = {
  scheduled: 'backup_',
  preRestore: 'pre_restore_'
}

/** Reads a vault filename, or null when it is not one of ours. */
export function parseBackupName(filename: string): { kind: BackupKind; timestamp: number } | null {
  if (!filename.endsWith('.db.gz')) return null
  for (const [kind, prefix] of Object.entries(PREFIXES) as [BackupKind, string][]) {
    if (!filename.startsWith(prefix)) continue
    const digits = filename.slice(prefix.length, -'.db.gz'.length)
    if (!/^\d+$/.test(digits)) return null
    return { kind, timestamp: parseInt(digits, 10) }
  }
  return null
}

/**
 * Trims each kind to `maxCount` separately.
 *
 * Pre-restore copies used to match neither the listing nor this, so every
 * restore left a full compressed database behind that nothing would ever show
 * or remove. A few restores and the vault quietly outgrew the data it guards.
 */
async function pruneBackups(backupDir: string, maxCount: number): Promise<void> {
  try {
    const byKind = new Map<BackupKind, { filename: string; timestamp: number }[]>()
    for (const filename of fs.readdirSync(backupDir)) {
      const parsed = parseBackupName(filename)
      if (!parsed) continue
      const list = byKind.get(parsed.kind) ?? []
      list.push({ filename, timestamp: parsed.timestamp })
      byKind.set(parsed.kind, list)
    }

    for (const files of byKind.values()) {
      files.sort((a, b) => a.timestamp - b.timestamp) // Oldest first
      if (files.length <= maxCount) continue
      for (const f of files.slice(0, files.length - maxCount)) {
        fs.unlinkSync(join(backupDir, f.filename))
      }
    }
  } catch (err) {
    console.error('Error during backup pruning:', err)
  }
}

export async function runBackup(): Promise<string> {
  if (isBackingUp) throw new Error('Backup is already in progress')
  isBackingUp = true

  const backupDir = getBackupDir()
  const timestamp = Date.now()
  const tempFile = join(backupDir, `temp_backup_${timestamp}.db`)
  const compressedFile = join(backupDir, `backup_${timestamp}.db.gz`)

  try {
    const db = getDb()

    // Asynchronous non-blocking SQLite backup snapshot
    await db.backup(tempFile)

    // Compress using asynchronous zlib stream pipeline
    await compressFile(tempFile, compressedFile)

    setSetting('last_backup_time', String(timestamp))

    // Prune old backups exceeding rolling retention count
    const maxCountStr = getSetting<string>('backup_max_count', '10')
    const maxCount = parseInt(maxCountStr, 10) || 10
    await pruneBackups(backupDir, maxCount)

    return compressedFile
  } finally {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    } catch (e) {
      console.error('Failed to clean up temporary backup file:', e)
    }
    isBackingUp = false
  }
}

export async function runRestore(filename: string): Promise<void> {
  const backupDir = getBackupDir()
  const sourcePath = join(backupDir, filename)
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Backup file not found: ${filename}`)
  }

  const timestamp = Date.now()
  const tempRestoreFile = join(backupDir, `temp_restore_${timestamp}.db`)

  try {
    // 1. Decompress backup file
    await decompressFile(sourcePath, tempRestoreFile)

    // 2. Validate SQLite database integrity before swapping
    let tempDb: Database.Database | null = null
    try {
      tempDb = new Database(tempRestoreFile)
      const integrity = tempDb.pragma('integrity_check')
      let checkVal = ''
      if (Array.isArray(integrity) && integrity.length > 0) {
        const row = integrity[0] as Record<string, unknown>
        checkVal = String(row.integrity_check || Object.values(row)[0] || row)
      } else {
        checkVal = String(integrity)
      }
      if (checkVal.toLowerCase() !== 'ok') {
        throw new Error(`Restored database is corrupted: ${checkVal}`)
      }
    } finally {
      if (tempDb) {
        tempDb.close()
      }
    }

    const dataPath = app.getPath('userData')
    const primaryDbFile = join(dataPath, 'checkpoint.db')
    const primaryWalFile = join(dataPath, 'checkpoint.db-wal')
    const primaryShmFile = join(dataPath, 'checkpoint.db-shm')

    // 3. Create pre-restore safety copy of the current active DB
    const safetyCopyPath = join(backupDir, `pre_restore_${timestamp}.db.gz`)
    const tempSafetyPath = join(backupDir, `temp_safety_${timestamp}.db`)
    try {
      const currentDb = getDb()
      await currentDb.backup(tempSafetyPath)
      await compressFile(tempSafetyPath, safetyCopyPath)
    } catch (safetyErr) {
      console.warn('Failed to create safety backup prior to restore:', safetyErr)
    } finally {
      if (fs.existsSync(tempSafetyPath)) {
        fs.unlinkSync(tempSafetyPath)
      }
    }

    // 4. Close the connection through db.ts, not by reaching for the handle.
    //
    // db.ts caches prepared statements keyed by SQL, compiled against whichever
    // connection was open at the time. Closing the raw handle left every one of
    // them pointing at a dead connection while `dbInstance` still looked live,
    // so after a restore the search, task, analytics and update paths all threw
    // "The database connection is not open" until the app was restarted.
    // discardDb drops the cache along with the connection.
    discardDb()

    // 5. Delete WAL/SHM journaling state files to prevent locks
    if (fs.existsSync(primaryWalFile)) fs.unlinkSync(primaryWalFile)
    if (fs.existsSync(primaryShmFile)) fs.unlinkSync(primaryShmFile)

    // 6. Overwrite primary database file
    fs.copyFileSync(tempRestoreFile, primaryDbFile)

    // 7. Re-initialize database connection
    initDb(dataPath)
  } finally {
    try {
      if (fs.existsSync(tempRestoreFile)) {
        fs.unlinkSync(tempRestoreFile)
      }
    } catch (e) {
      console.error('Failed to clean up temporary restore file:', e)
    }
  }
}

export function listCompletedBackups(): {
  filename: string
  timestamp: number
  size: number
  kind: BackupKind
}[] {
  const backupDir = getBackupDir()
  try {
    if (!fs.existsSync(backupDir)) return []

    // Pre-restore copies are listed too. Taking one and then hiding it meant
    // the safety net existed on disk and nowhere the user could reach it.
    return fs.readdirSync(backupDir)
      .map(filename => {
        const parsed = parseBackupName(filename)
        if (!parsed) return null
        const stats = fs.statSync(join(backupDir, filename))
        return {
          filename,
          timestamp: parsed.timestamp || stats.mtimeMs,
          size: stats.size,
          kind: parsed.kind
        }
      })
      .filter((b): b is { filename: string; timestamp: number; size: number; kind: BackupKind } => b !== null)
      .sort((a, b) => b.timestamp - a.timestamp) // Newest first
  } catch (err) {
    console.error('Failed to list backups:', err)
    return []
  }
}

export function deleteBackup(filename: string): void {
  const backupDir = getBackupDir()
  const filePath = join(backupDir, filename)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function initializeBackupScheduler(): void {
  // Clear existing timers
  shutdownBackupScheduler()

  const isEnabled = getSetting<string>('feature_backup', 'true') !== 'false'
  if (!isEnabled) return

  const interval = getSetting<string>('backup_interval', 'daily')

  if (interval === 'launch-exit') {
    // Run backup immediately on boot
    runBackup().catch(err => console.error('Failed to run boot backup:', err))
    return
  }

  // Setup hourly check timer
  const checkInterval = 60 * 60 * 1000 // 1 hour
  backupTimer = setInterval(() => {
    checkAndRunTimedBackup()
  }, checkInterval)

  // Run initial check after a brief delay. Stored so it can be cancelled on early quit
  initialCheckTimer = setTimeout(() => {
    initialCheckTimer = null
    checkAndRunTimedBackup()
  }, 5000)
}

async function checkAndRunTimedBackup() {
  const isEnabled = getSetting<string>('feature_backup', 'true') !== 'false'
  if (!isEnabled) {
    shutdownBackupScheduler()
    return
  }

  const interval = getSetting<string>('backup_interval', 'daily')
  if (interval === 'launch-exit') {
    shutdownBackupScheduler()
    return
  }

  const lastBackupStr = getSetting<string>('last_backup_time', '0')
  const lastBackup = parseInt(lastBackupStr, 10) || 0

  const intervalMs = interval === 'weekly'
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000 // default daily

  if (Date.now() - lastBackup >= intervalMs) {
    try {
      console.log(`[BackupScheduler] Triggering scheduled ${interval} backup...`)
      const file = await runBackup()
      console.log(`[BackupScheduler] Scheduled backup completed: ${file}`)
    } catch (err) {
      console.error('[BackupScheduler] Scheduled backup failed:', err)
    }
  }
}

export function shutdownBackupScheduler(): void {
  if (initialCheckTimer) {
    clearTimeout(initialCheckTimer)
    initialCheckTimer = null
  }
  if (backupTimer) {
    clearInterval(backupTimer)
    backupTimer = null
  }

  // Synchronously run backup on exit if requested
  try {
    const isEnabled = getSetting<string>('feature_backup', 'true') !== 'false'
    const interval = getSetting<string>('backup_interval', 'daily')
    if (isEnabled && interval === 'launch-exit') {
      console.log('[BackupScheduler] Running exit backup...')

      const backupDir = getBackupDir()
      const timestamp = Date.now()
      const tempFile = join(backupDir, `temp_exit_backup_${timestamp}.db`)
      const compressedFile = join(backupDir, `backup_${timestamp}.db.gz`)

      const dataPath = app.getPath('userData')
      const primaryDbFile = join(dataPath, 'checkpoint.db')

      if (fs.existsSync(primaryDbFile)) {
        fs.copyFileSync(primaryDbFile, tempFile)

        // Compress synchronously on exit to prevent thread termination
        const gzip = zlib.gzipSync(fs.readFileSync(tempFile))
        fs.writeFileSync(compressedFile, gzip)

        fs.unlinkSync(tempFile)

        // Prune synchronously
        const maxCountStr = getSetting<string>('backup_max_count', '10')
        const maxCount = parseInt(maxCountStr, 10) || 10
        const files = fs.readdirSync(backupDir)
          .filter(f => f.startsWith('backup_') && f.endsWith('.db.gz'))
          .map(f => {
            const match = f.match(/^backup_(\d+)\.db\.gz$/)
            return {
              filename: f,
              timestamp: match ? parseInt(match[1], 10) : 0
            }
          })
          .sort((a, b) => a.timestamp - b.timestamp)

        if (files.length > maxCount) {
          const toPrune = files.slice(0, files.length - maxCount)
          for (const f of toPrune) {
            fs.unlinkSync(join(backupDir, f.filename))
          }
        }

        console.log('[BackupScheduler] Exit backup completed:', compressedFile)
      }
    }
  } catch (err) {
    console.error('[BackupScheduler] Exit backup failed:', err)
  }
}
