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

/** scratch name then rename, so a killed write never looks like a real backup */
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

/** preRestore: live db copied before a restore, so a mistaken restore can be undone */
type BackupKind = 'scheduled' | 'preRestore'

const PREFIXES: Record<BackupKind, string> = {
  scheduled: 'backup_',
  preRestore: 'pre_restore_'
}

/** null when not one of ours */
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

/** trims each kind separately; pre-restore copies used to pile up forever */
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
      files.sort((a, b) => a.timestamp - b.timestamp) // oldest first
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

    await db.backup(tempFile)

    await compressFile(tempFile, compressedFile)

    setSetting('last_backup_time', String(timestamp))

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
    await decompressFile(sourcePath, tempRestoreFile)

    // check integrity before swapping anything
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

    // safety copy of the live db first
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

    // close via the db module, cached statements would point at the dead connection
    discardDb()

    // leftover WAL/SHM would lock the swap
    if (fs.existsSync(primaryWalFile)) fs.unlinkSync(primaryWalFile)
    if (fs.existsSync(primaryShmFile)) fs.unlinkSync(primaryShmFile)

    fs.copyFileSync(tempRestoreFile, primaryDbFile)

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

    // list pre-restore copies too, a hidden safety net is useless
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
      .sort((a, b) => b.timestamp - a.timestamp) // newest first
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
  shutdownBackupScheduler()

  const isEnabled = getSetting<string>('feature_backup', 'true') !== 'false'
  if (!isEnabled) return

  const interval = getSetting<string>('backup_interval', 'daily')

  if (interval === 'launch-exit') {
    runBackup().catch(err => console.error('Failed to run boot backup:', err))
    return
  }

  const checkInterval = 60 * 60 * 1000 // 1 hour
  backupTimer = setInterval(() => {
    checkAndRunTimedBackup()
  }, checkInterval)

  // stored so an early quit can cancel it
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

        // sync on exit, async work dies with the process
        const gzip = zlib.gzipSync(fs.readFileSync(tempFile))
        fs.writeFileSync(compressedFile, gzip)

        fs.unlinkSync(tempFile)

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
