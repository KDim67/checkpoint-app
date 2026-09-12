/** The encrypted backup vault. */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'

export function registerBackupHandlers(): void {
  ipcMain.handle(IpcChannels.BACKUP_RUN, async (_event, action?: 'backup' | 'restore' | 'delete' | 'init', filename?: string) => {
    const { runBackup, runRestore, deleteBackup, initializeBackupScheduler } = await import('../backupVault')
    if (action === 'restore' && filename) {
      await runRestore(filename)
    } else if (action === 'delete' && filename) {
      deleteBackup(filename)
    } else if (action === 'init') {
      initializeBackupScheduler()
    } else {
      await runBackup()
    }
  })

  ipcMain.handle(IpcChannels.BACKUP_STATUS, async () => {
    const { getBackupDir, listCompletedBackups } = await import('../backupVault')
    const { getSetting } = await import('../db')
    const enabled = getSetting<string>('feature_backup', 'true') !== 'false'
    const interval = getSetting<string>('backup_interval', 'daily')
    const path = getBackupDir()
    const maxCountStr = getSetting<string>('backup_max_count', '10')
    const maxCount = parseInt(maxCountStr, 10) || 10
    const backups = listCompletedBackups()
    return { enabled, interval, path, maxCount, backups }
  })
}
