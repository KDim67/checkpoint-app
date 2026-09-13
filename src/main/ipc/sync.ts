/** LAN sync between machines, and applying what arrives */

import { ipcMain } from 'electron'
import { IpcChannels } from '../../shared/ipcChannels'
import { SyncService } from '../syncService'

const syncService = new SyncService()

/** for the shutdown sweep */
export function stopSyncHost(): void {
  syncService.stopHost()
}
import { app } from 'electron'
import type { SyncPayload } from '../../shared/types'
import path from 'path'
import fs from 'fs'

export function registerSyncHandlers(): void {
  ipcMain.handle(IpcChannels.SYNC_START_HOST, (_event, port?: number) => {
    syncService.startHost(port)
  })

  ipcMain.handle(IpcChannels.SYNC_STOP_HOST, () => {
    syncService.stopHost()
  })

  ipcMain.handle(IpcChannels.SYNC_CONNECT_AND_SYNC, async (_event, hostIp: string, port: number, pairingCode: string) => {
    const dataPath = app.getPath('userData')
    return syncService.connectAndSync(hostIp, port, pairingCode, dataPath)
  })

  ipcMain.handle(IpcChannels.SYNC_GET_STATUS, () => {
    return syncService.getStatus()
  })

  ipcMain.handle(IpcChannels.SYNC_GET_DISCOVERED_PEERS, () => {
    return syncService.getDiscoveredPeers()
  })

  ipcMain.handle(IpcChannels.SYNC_GET_DB_PAYLOAD, () => {
    return syncService.getDatabasePayload()
  })

  ipcMain.handle(IpcChannels.SYNC_APPLY_DB_PAYLOAD, (_event, payload: SyncPayload) => {
    return syncService.applyDatabasePayload(payload)
  })

  ipcMain.handle(IpcChannels.SYNC_GET_FILE_INDEX, (_event, subDir: 'notes' | 'media') => {
    const dataPath = app.getPath('userData')
    return syncService.getFileIndex(subDir, dataPath)
  })

  ipcMain.handle(IpcChannels.SYNC_READ_FILE_CHUNK, async (_event, subDir: 'notes' | 'media', relPath: string) => {
    const dataPath = app.getPath('userData')
    const filePath = path.join(dataPath, subDir, relPath)
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath)
  })

  ipcMain.handle(IpcChannels.SYNC_WRITE_FILE_CHUNK, async (_event, subDir: 'notes' | 'media', relPath: string, buffer: ArrayBuffer, mtime?: number) => {
    const dataPath = app.getPath('userData')
    const destDir = path.join(dataPath, subDir)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const destPath = path.join(destDir, relPath)
    fs.writeFileSync(destPath, Buffer.from(buffer))
    if (mtime) {
      const timeSecs = mtime / 1000
      fs.utimesSync(destPath, timeSecs, timeSecs)
    }
  })

  ipcMain.handle(IpcChannels.SYNC_DELETE_FILE, async (_event, subDir: 'notes' | 'media', relPath: string) => {
    const dataPath = app.getPath('userData')
    const filePath = path.join(dataPath, subDir, relPath)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  })

  // validated again here, the rows reach SQL through this handler whoever the caller is
  ipcMain.handle(IpcChannels.SYNC_APPLY_BOARD_BASELINE, async (
    _event,
    context: unknown,
    items: unknown,
    tags: unknown,
    itemTags: unknown,
    relations: unknown
  ) => {
    const { applyBoardBaselineTx } = await import('../db')
    const { normalizeCollabMessage } = await import('../../shared/collabProtocol')
    const baseline = normalizeCollabMessage({ type: 'board-baseline', context, items, tags, itemTags, relations })
    if (!baseline || baseline.type !== 'board-baseline') return
    return applyBoardBaselineTx(
      baseline.context,
      baseline.items,
      baseline.tags,
      baseline.itemTags,
      baseline.relations
    )
  })

  ipcMain.handle(IpcChannels.SYNC_APPLY_REMOTE_MUTATION, async (_event, mutation: unknown) => {
    const { applyRemoteMutationTx } = await import('../db')
    const { normalizeRemoteMutation } = await import('../../shared/collabProtocol')
    const safe = normalizeRemoteMutation(mutation)
    if (!safe) {
      console.warn('[sync] Dropped a remote mutation this build cannot apply.')
      return
    }
    return applyRemoteMutationTx(safe)
  })
}
